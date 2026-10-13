# BRISS Studio

A self-hosted browser rebuild of BRISS 0.9. React + TypeScript editor, Python/FastAPI
API, PyMuPDF crop engine and PDF.js preview. No Java runtime is needed.

## Run with Docker

```sh
cp .env.example .env
docker compose up --build -d
```

Open http://localhost:8000. Compose binds to localhost by default. Set
`BRISS_BIND_ADDRESS=0.0.0.0` and a long `BRISS_ACCESS_TOKEN` for LAN access, or keep
the default binding and use an HTTPS reverse proxy. One container serves the
compiled frontend and API. The image runs as UID 10001 and uses a named `/data`
volume; the root filesystem is read-only under Compose.

Docker execution has not been verified on the development host because Docker
is not installed. The same server entry point and production frontend were
verified directly. See [validation](docs/validation.md).

## Run locally

Python 3.13+ and Node 22.12+:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
npm ci --prefix web
npm run build --prefix web
.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8000
```

For frontend development run `npm run dev --prefix web` in another terminal.
Vite proxies `/api` to the Python server. Production needs no Node process.
Fonts, PDF.js worker, CMaps, standard fonts and WASM assets are bundled locally.
After installation the application does not require internet access.

## Using the editor

1. Upload/drop a PDF, or try the generated sample. Password-protected PDFs prompt
   for their password. A private decrypted session copy is stored on your server.
2. Similar page sizes and odd/even pages form overlay groups. Auto crop suggests
   a content boundary. Overlays sample up to 15 evenly spaced pages; single-page
   view lets you inspect other pages before exporting.
3. Draw, drag or resize crop rectangles. Each region produces one output page,
   in the listed region order, inside the original source-page order.
4. Select a region to edit position/size in points, millimeters or inches.
   Shift/Ctrl/Cmd-click selects several. Match selected widths/heights, match all
   region sizes, copy/paste between groups, delete, reorder, reset, undo or redo.
5. Preview the actual export in the integrated viewer, then download the PDF.
   Save a `.briss.json` crop recipe to reuse the plan with the same input file.

Group settings support parity + size, size only, or individual pages. Excluded
page ranges (`1, 4-6`, also semicolons) become individual groups and remain in
output. Regrouping inherits the first source page's crop plan for each new group;
undo history resets when grouping changes. Save a recipe to retain the old plan.
A group with no crop rectangles keeps its original pages.

The export copies original vector content and changes page boxes. Standard and
scalar custom metadata, XMP metadata, bookmarks, named destinations, applicable
links, annotations and form widgets are retained. Internal destinations map to
the first split output page. Cropping is **not redaction**: content outside the
visible box remains in the PDF. Signed documents are modified copies and existing
digital signatures are not preserved as valid signatures.

## Automatic command-line cropping

```sh
.venv/bin/python -m server.cli -s input.pdf -d cropped.pdf --margin 6
.venv/bin/python -m server.cli -s input.pdf --group individual --exclude '1,4-6'
```

The default output is `input_cropped.pdf`. Existing files and the source file are
never overwritten by the CLI. Encrypted input prompts for a password.

## Server settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRISS_ACCESS_TOKEN` | empty | Optional shared access token / sign-in gate |
| `BRISS_MAX_UPLOAD_MB` | 100 | Maximum PDF upload size |
| `BRISS_MAX_PAGES` | 2000 | Maximum source pages |
| `BRISS_MAX_SESSIONS` | 100 | Maximum stored document sessions |
| `BRISS_SESSION_TTL_HOURS` | 24 | Expire idle sessions after this period |
| `BRISS_DATA_DIR` | `.data` | Private session storage (container: `/data`) |
| `BRISS_WEB_DIR` | `web/dist` | Built frontend directory |

Session IDs are random, unlisted capabilities. Recipes and the current session
are remembered in browser storage; source files remain on the server. Closing a
document removes its server session. Idle sessions are swept every minute and on
startup/upload. Passwords are never persisted. The shared access token is stored
in an HttpOnly same-site cookie after sign-in. This is a personal/team workspace,
not a multi-tenant user-account service.

Exports are limited to 10,000 output pages.

Use **one Uvicorn worker**: PDF operations are serialized behind a lock because
PyMuPDF is not thread-safe. Scale separate instances with separate volumes rather
than sharing a volume between independent processes. Defaults bound uploads,
source/output page counts and session count; provision disk space for stored PDFs
and cached previews. Configure reverse-proxy upload limits and timeouts for your
expected document sizes (e.g. Nginx `client_max_body_size 101m;` and
`proxy_read_timeout 300s;`). Preserve the original Host header and forward the
HTTPS scheme from a trusted proxy. The API rejects cross-origin mutations.

API schema: `/docs`. Health check: `/api/health`. Authentication for scripts:
`Authorization: Bearer YOUR_TOKEN`. No cloud APIs or external processing services.

## Tests

```sh
.venv/bin/pip install pytest pytest-cov httpx black ruff mypy types-Pillow
.venv/bin/pytest --cov=server --cov-report=term-missing
.venv/bin/mypy server
.venv/bin/ruff check server
.venv/bin/black --check server tests
npm test --prefix web
npm run build --prefix web
```

The original files in this folder are preserved as reference artifacts. See
[reverse-engineering evidence](docs/reverse-engineering/findings.md).

## License

The rebuild is provided under AGPL-3.0-or-later; see `LICENSE`. BRISS 0.9 is GPLv3
and remains the work of Gerhard Aigner and contributors. No original Java code or
binary dependencies are included in the Docker image. PyMuPDF/MuPDF uses AGPL or
commercial licensing. Third-party dependency licenses remain applicable; see
[third-party notices](THIRD_PARTY_NOTICES.md).
