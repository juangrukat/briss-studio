"""Same-origin API and static frontend for BRISS Studio."""

import asyncio
import hmac
import logging
import os
import threading
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pymupdf as fitz
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import storage
from .models import AutoOptions, ExportPlan, Group, GroupOptions
from .pdf import demo_pdf, detect, export_pdf, groups_for, overlay, png, render_page

# PyMuPDF is not thread-safe. All library calls are serialized, including cleanup.
PDF_LOCK = threading.RLock()
TOKEN = os.getenv("BRISS_ACCESS_TOKEN", "")
LOG = logging.getLogger("briss")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    with PDF_LOCK:
        storage.clean()

    async def sweep() -> None:
        while True:
            await asyncio.sleep(60)

            def cleanup() -> None:
                with PDF_LOCK:
                    storage.clean()

            await run_in_threadpool(cleanup)

    task = asyncio.create_task(sweep())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="BRISS Studio", version="1.0.0", lifespan=lifespan)


@app.middleware("http")
async def protect(request: Request, call_next: Callable[..., Any]) -> Response:
    """Optional shared access gate plus same-origin mutation protection."""
    if request.url.path.startswith("/api/") and request.url.path not in (
        "/api/health",
        "/api/auth",
        "/api/config",
    ):
        credential = request.cookies.get("briss_access", "")
        bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
        if TOKEN and not (
            hmac.compare_digest(credential, TOKEN) or hmac.compare_digest(bearer, TOKEN)
        ):
            return JSONResponse(
                {"detail": "Sign in with the server access token."}, status_code=401
            )
    origin = request.headers.get("origin")
    if request.method in ("POST", "PUT", "DELETE") and origin:
        from urllib.parse import urlparse

        if urlparse(origin).netloc != request.headers.get("host"):
            return JSONResponse(
                {"detail": "Cross-origin requests are not allowed."}, status_code=403
            )
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(ValueError)
async def invalid(request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(FileNotFoundError)
async def missing(request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.exception_handler(PermissionError)
async def locked(request: Request, exc: PermissionError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def config(request: Request) -> dict[str, Any]:
    return {
        "auth_required": bool(TOKEN),
        "authenticated": not TOKEN
        or hmac.compare_digest(request.cookies.get("briss_access", ""), TOKEN),
        "max_upload_mb": storage.MAX_BYTES // 1024 // 1024,
        "max_pages": storage.MAX_PAGES,
    }


@app.post("/api/auth")
def login(request: Request, token: str = Form(...)) -> Response:
    if not TOKEN or not hmac.compare_digest(token, TOKEN):
        raise HTTPException(401, "Invalid access token.")
    response = JSONResponse({"ok": True})
    response.set_cookie(
        "briss_access",
        token,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
        max_age=86400,
    )
    return response


@app.post("/api/documents")
async def upload(
    file: UploadFile = File(...), password: str = Form("")
) -> dict[str, Any]:
    data = bytearray()
    try:
        while chunk := await file.read(1024 * 1024):
            data.extend(chunk)
            if len(data) > storage.MAX_BYTES:
                raise HTTPException(413, "This PDF exceeds the server upload limit.")

        def save() -> dict[str, Any]:
            with PDF_LOCK:
                return storage.register(
                    bytes(data), file.filename or "document.pdf", password
                )

        return await run_in_threadpool(save)
    finally:
        await file.close()


@app.post("/api/demo")
def demo() -> dict[str, Any]:
    with PDF_LOCK:
        return storage.register(demo_pdf(), "field-notes.pdf")


@app.get("/api/documents/{session}")
def document(session: str) -> dict[str, Any]:
    with PDF_LOCK:
        return storage.read_manifest(session)


@app.put("/api/documents/{session}/groups")
def regroup(session: str, options: GroupOptions) -> dict[str, Any]:
    with PDF_LOCK:
        manifest = storage.read_manifest(session)
        directory = storage.folder(session)
        with fitz.open(directory / "source.pdf") as doc:
            manifest["groups"] = [g.model_dump() for g in groups_for(doc, options)]
        manifest["options"] = options.model_dump()
        storage.write_manifest(directory, manifest)
        return manifest


def find_group(session: str, group_id: str) -> Group:
    """Validate group identity against the current session manifest."""
    manifest = storage.read_manifest(session)
    for group in manifest["groups"]:
        if group["id"] == group_id:
            return Group.model_validate(group)
    raise ValueError("This page group no longer exists. Reload the document.")


@app.get("/api/documents/{session}/groups/{group_id}/image")
def group_image(session: str, group_id: str) -> Response:
    with PDF_LOCK:
        group = find_group(session, group_id)
        directory = storage.folder(session)
        cache = directory / f"overlay-{group.id}.png"
        if cache.exists():
            return Response(cache.read_bytes(), media_type="image/png")
        with fitz.open(directory / "source.pdf") as doc:
            result = png(overlay(doc, group))
        cache.write_bytes(result)
        return Response(result, media_type="image/png")


@app.get("/api/documents/{session}/pages/{number}/image")
def page_image(session: str, number: int) -> Response:
    with PDF_LOCK, fitz.open(storage.folder(session) / "source.pdf") as doc:
        if not 1 <= number <= len(doc):
            raise ValueError("Page number is outside the document.")
        return Response(png(render_page(doc[number - 1])), media_type="image/png")


@app.post("/api/documents/{session}/auto")
def auto(session: str, options: AutoOptions) -> dict[str, Any]:
    with PDF_LOCK:
        manifest = storage.read_manifest(session)
        with fitz.open(storage.folder(session) / "source.pdf") as doc:
            return {
                group["id"]: detect(
                    doc, Group.model_validate(group), options.margin, options.threshold
                ).model_dump()
                for group in manifest["groups"]
            }


@app.post("/api/documents/{session}/groups/{group_id}/auto")
def auto_group(session: str, group_id: str, options: AutoOptions) -> dict[str, float]:
    with PDF_LOCK:
        group = find_group(session, group_id)
        with fitz.open(storage.folder(session) / "source.pdf") as doc:
            return dict(
                detect(doc, group, options.margin, options.threshold).model_dump()
            )


@app.post("/api/documents/{session}/export")
def export(session: str, plan: ExportPlan) -> Response:
    with PDF_LOCK:
        manifest = storage.read_manifest(session)
        with fitz.open(storage.folder(session) / "source.pdf") as doc:
            data = export_pdf(doc, plan)
        name = Path(manifest["filename"]).stem + "_cropped.pdf"
        return Response(
            data,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"
            },
        )


@app.delete("/api/documents/{session}")
def delete(session: str) -> dict[str, bool]:
    import shutil

    with PDF_LOCK:
        shutil.rmtree(storage.folder(session))
    return {"ok": True}


DIST = Path(os.getenv("BRISS_WEB_DIR", "web/dist"))
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "pdf-assets").exists():
        app.mount(
            "/pdf-assets", StaticFiles(directory=DIST / "pdf-assets"), name="pdf-assets"
        )


@app.get("/")
def index() -> FileResponse:
    if not (DIST / "index.html").exists():
        raise HTTPException(503, "Build the frontend with npm run build in web/.")
    return FileResponse(DIST / "index.html")
