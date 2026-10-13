"""Private file-backed sessions with bounded storage and atomic manifests."""

import hashlib
import json
import os
import re
import secrets
import shutil
import time
from pathlib import Path
from typing import Any

import pymupdf as fitz

from .models import GroupOptions
from .pdf import groups_for

DATA = Path(os.getenv("BRISS_DATA_DIR", ".data"))
MAX_BYTES = int(os.getenv("BRISS_MAX_UPLOAD_MB", "100")) * 1024 * 1024
MAX_PAGES = int(os.getenv("BRISS_MAX_PAGES", "2000"))
MAX_SESSIONS = int(os.getenv("BRISS_MAX_SESSIONS", "100"))
TTL = int(os.getenv("BRISS_SESSION_TTL_HOURS", "24")) * 3600


def clean() -> None:
    """Expire old sessions; caller holds the process-wide PDF lock."""
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    for directory in DATA.iterdir():
        if directory.is_dir() and time.time() - directory.stat().st_mtime > TTL:
            shutil.rmtree(directory)


def folder(session: str) -> Path:
    """Resolve only high-entropy session IDs, without exposing a session list."""
    if not re.fullmatch(r"[a-f0-9]{48}", session):
        raise FileNotFoundError("Document session expired or does not exist.")
    directory = DATA / session
    if not directory.is_dir() or time.time() - directory.stat().st_mtime > TTL:
        raise FileNotFoundError("Document session expired or does not exist.")
    directory.touch()
    return directory


def write_manifest(directory: Path, manifest: dict[str, Any]) -> None:
    """Atomic replacement makes sessions restart-safe."""
    temporary = directory / "manifest.tmp"
    temporary.write_text(json.dumps(manifest), encoding="utf-8")
    temporary.replace(directory / "manifest.json")


def read_manifest(session: str) -> dict[str, Any]:
    """Read persisted document metadata."""
    return dict(json.loads((folder(session) / "manifest.json").read_text()))


def register(data: bytes, filename: str, password: str = "") -> dict[str, Any]:
    """Authenticate, validate, and store a private decrypted session copy."""
    clean()
    if len(list(DATA.iterdir())) >= MAX_SESSIONS:
        raise ValueError(
            "Server session capacity reached. Close a document or try again later."
        )
    if len(data) > MAX_BYTES:
        raise ValueError("This PDF exceeds the server upload limit.")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise ValueError("This file is not a readable PDF.") from exc
    with doc:
        if doc.needs_pass and not doc.authenticate(password):
            raise PermissionError("This PDF needs a valid password.")
        if not 1 <= len(doc) <= MAX_PAGES:
            raise ValueError(f"PDFs must contain between 1 and {MAX_PAGES} pages.")
        # Reject pathological page geometry before rendering allocates memory.
        for p in doc:
            if p.rect.is_empty or not all(
                0 < v < 1e7 for v in (p.rect.width, p.rect.height)
            ):
                raise ValueError("The PDF has invalid page dimensions.")
        groups = groups_for(doc, GroupOptions())
        session = secrets.token_hex(24)
        manifest = {
            "id": session,
            "filename": Path(filename.replace("\\", "/")).name[:200],
            "fingerprint": hashlib.sha256(data).hexdigest(),
            "page_count": len(doc),
            "metadata": doc.metadata,
            "groups": [g.model_dump() for g in groups],
            "options": GroupOptions().model_dump(),
            "created": time.time(),
        }
        directory = DATA / session
        directory.mkdir(mode=0o700)
        try:
            doc.save(directory / "source.pdf", encryption=fitz.PDF_ENCRYPT_NONE)
            write_manifest(directory, manifest)
        except Exception:
            shutil.rmtree(directory)
            raise
        return manifest
