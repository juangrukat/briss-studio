import time
import pymupdf as f
import pytest
from fastapi.testclient import TestClient
from server import storage
from server import app as module
from server.pdf import demo_pdf


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "DATA", tmp_path / "data")
    monkeypatch.setattr(module, "TOKEN", "")
    with TestClient(module.app) as c:
        yield c


def test_lifecycle_and_restart_persistence(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/config").json()["max_upload_mb"] == 100
    result = client.post("/api/demo")
    assert result.status_code == 200
    d = result.json()
    session = d["id"]
    g = d["groups"][0]
    assert (
        client.get(f"/api/documents/{session}").json()["filename"] == "field-notes.pdf"
    )
    for _ in range(2):
        image = client.get(f'/api/documents/{session}/groups/{g["id"]}/image')
        assert image.status_code == 200 and image.content.startswith(b"\x89PNG")
    assert client.get(f"/api/documents/{session}/pages/1/image").status_code == 200
    assert client.get(f"/api/documents/{session}/pages/0/image").status_code == 400
    assert client.get(f"/api/documents/{session}/groups/bad/image").status_code == 400
    detected = client.post(f"/api/documents/{session}/auto", json={}).json()
    rect = client.post(
        f'/api/documents/{session}/groups/{g["id"]}/auto', json={}
    ).json()
    assert rect == detected[g["id"]]
    plan = {
        "groups": [
            {"pages": x["pages"], "rects": [detected[x["id"]]]} for x in d["groups"]
        ]
    }
    export = client.post(f"/api/documents/{session}/export", json=plan)
    assert (
        export.status_code == 200
        and export.headers["content-type"] == "application/pdf"
    )
    assert "field-notes_cropped.pdf" in export.headers["content-disposition"]
    with f.open(stream=export.content, filetype="pdf") as out:
        assert len(out) == 6
    changed = client.put(
        f"/api/documents/{session}/groups", json={"mode": "parity", "excludes": "1,6"}
    ).json()
    assert len(changed["groups"]) == 4
    assert (
        client.get(f"/api/documents/{session}").json()["options"]["excludes"] == "1,6"
    )
    assert (
        client.put(
            f"/api/documents/{session}/groups", json={"excludes": "7"}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/documents/{session}/export", json={"groups": [{"pages": [1]}]}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/documents/{session}/export",
            json={
                "groups": [{"pages": [1], "rects": [{"x": 0, "y": 0, "w": 2, "h": 1}]}]
            },
        ).status_code
        == 422
    )
    assert client.delete(f"/api/documents/{session}").status_code == 200
    assert client.get(f"/api/documents/{session}").status_code == 404
    assert client.get("/api/documents/../../../etc").status_code == 404


def test_upload_validation_password_and_limit(client, monkeypatch):
    assert (
        client.post("/api/documents", files={"file": ("bad.pdf", b"bad")}).status_code
        == 400
    )
    assert (
        client.post(
            "/api/documents", files={"file": ("../sample.pdf", demo_pdf())}
        ).json()["filename"]
        == "sample.pdf"
    )
    d = f.open(stream=demo_pdf(), filetype="pdf")
    data = d.tobytes(
        encryption=f.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner"
    )
    d.close()
    assert (
        client.post("/api/documents", files={"file": ("locked.pdf", data)}).status_code
        == 422
    )
    uploaded = client.post(
        "/api/documents",
        files={"file": ("locked.pdf", data)},
        data={"password": "secret"},
    )
    assert uploaded.status_code == 200
    with f.open(storage.DATA / uploaded.json()["id"] / "source.pdf") as opened:
        assert not opened.needs_pass
    monkeypatch.setattr(storage, "MAX_BYTES", 10)
    assert (
        client.post(
            "/api/documents", files={"file": ("huge.pdf", demo_pdf())}
        ).status_code
        == 413
    )


def test_auth_and_origin(client, monkeypatch):
    monkeypatch.setattr(module, "TOKEN", "test-token")
    assert client.post("/api/demo").status_code == 401
    assert client.post("/api/auth", data={"token": "wrong"}).status_code == 401
    assert client.post("/api/auth", data={"token": "test-token"}).status_code == 200
    assert client.post("/api/demo").status_code == 200
    assert (
        client.post("/api/demo", headers={"origin": "https://evil.example"}).status_code
        == 403
    )
    client.cookies.clear()
    assert (
        client.post(
            "/api/demo", headers={"Authorization": "Bearer test-token"}
        ).status_code
        == 200
    )


def test_expiry_capacity_and_page_limit(client, monkeypatch):
    d = client.post("/api/demo").json()
    folder = storage.DATA / d["id"]
    import os

    os.utime(folder, (time.time() - storage.TTL - 1,) * 2)
    assert client.get(f'/api/documents/{d["id"]}').status_code == 404
    client.post("/api/demo")
    assert not folder.exists()
    monkeypatch.setattr(storage, "MAX_SESSIONS", 1)
    assert client.post("/api/demo").status_code == 400
    monkeypatch.setattr(storage, "MAX_SESSIONS", 10)
    monkeypatch.setattr(storage, "MAX_PAGES", 1)
    assert client.post("/api/demo").status_code == 400


def test_static_frontend_and_invalid_session(client):
    assert client.get("/").status_code in (200, 503)
    assert client.get("/api/documents/not-an-id").status_code == 404
    assert client.post("/api/auth", data={"token": "anything"}).status_code == 401
