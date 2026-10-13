# BRISS Studio design

Approved direction: user approved a modern browser rebuild, React/TypeScript UI,
Python PDF processing, self-hosted Docker delivery, and improvements to the old UI.

## Behavior
Upload or drop a PDF; enter password if encrypted. Group displayed pages by
odd/even parity and dimensions bucketed to 20 PDF points, ordered by first page.
Excluded overlay pages form individual editable groups rather than disappearing
from output. Sample at most 15 evenly spaced pages for merged previews, explicitly
show sample counts. Allow all-pages grouping as an improvement.

Crop rectangles use normalized coordinates in displayed (rotated) page space.
Draw, drag, resize, select several, copy/paste between groups, delete, set exact
position/size, match maximum widths/heights, reorder regions, auto-detect bounds,
reset to full page. Export pages in original document order and rectangle order.
Groups without rectangles retain original pages. Preserve vector content, metadata,
bookmarks and applicable links/annotations. Preview uses the exact export engine.
Changing grouping retains crop plans by page association. Add undo/redo, zoom,
individual page view, recipe save/load with document fingerprint validation,
keyboard help and a generated demonstration document. Provide automatic CLI crop.

## Architecture
React/Vite/TypeScript editor, FastAPI API, PyMuPDF rendering/cropping, Pillow/NumPy
merged previews. One container serves API and compiled UI on port 8000.
File-backed sessions with cryptographically random IDs, per-document locks,
TTL cleanup and configurable upload/page/storage limits. Passwords authenticate
uploads then store a decrypted private session copy; never save passwords.
Persist session manifests atomically. Non-root container, health check, data volume,
optional shared access token, same-origin UI/API, reverse-proxy deployment guidance.

## UI
Warm off-white workspace, dark teal navigation, emerald crop outlines, clear
three-step workflow. Group sidebar, central canvas and right inspector. Compact
responsive header, labeled icon buttons, strong focus styles and responsive
panel layout. Drag/drop upload and sample document make first use straightforward.

## Errors and verification
User-facing errors for malformed/encrypted PDFs, expired sessions, invalid ranges,
invalid rectangles, and server capacity. Tests cover rotation/cropbox coordinate
transforms, split page order, text/vector retention, metadata, outline remapping,
links, individual excludes, range validation, API lifecycle, CLI and recipe handling.
Typecheck and production frontend build; browser exercise upload/edit/preview/export.
Docker build/run when Docker is available; otherwise clearly report unverified build.
