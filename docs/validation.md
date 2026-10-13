# Validation — October 13, 2026

## Automated checks

- Python regression suite: 52 tests passed; 96% server statement coverage.
- Frontend geometry/recipe suite: 7 tests passed.
- TypeScript strict typecheck and Vite production build passed.
- Python strict mypy, Ruff and Black checks passed. PyMuPDF's incomplete typing
  is isolated at its native-library boundary in the mypy configuration.
- npm audit: zero known vulnerabilities for the complete dependency tree.
- All 18 pinned runtime dependencies successfully resolved/downloaded as binary
  wheels for Python 3.13 on Linux x86-64, matching the Docker runtime platform.

Regression cases include four rotations with and without pre-existing crop boxes,
pixel comparisons, physical MediaBox sizing, split output order, vector/text
retention, annotation/widget copying, standard/custom/XMP metadata, rich bookmark
coordinates and split-page remapping, named destinations and internal named links,
blank-page auto detection, 20-point grouping, 15-page sampling, range validation,
password authentication/decrypted storage, upload/page/session limits, persistence,
expiration, shared access tokens, same-origin protection and CLI overwrite safety.

## Browser verification

Tested the production build through the Codex in-app browser:

- Generated sample and actual file-chooser upload of a six-page PDF.
- Automatic crop, pointer-drawn second region, exact width editing, undo and redo.
- Copy/paste between odd/even page groups, with output counts changing correctly.
- Millimeter display and region precision controls.
- Save recipe, reset group, and restore recipe using the file chooser.
- Regroup with page 1 excluded: cover became an individual editable group and
  remained in the six-page output.
- Integrated PDF.js preview rendered original text/vector content and navigated
  the split second output page. Native iframe preview was replaced after an
  observed lack of native PDF support in this browser.
- Browser-exported nine-page PDF reopened independently with PyMuPDF: correct
  crop sizes, title and bookmark mappings to pages 1, 4 and 7.
- Mobile layout at 390 × 844: no horizontal document overflow; page-group drawer
  could be opened/closed and crop canvas remained reachable. Desktop restored.
- Final screenshot: `screenshots/briss-studio.jpg`.

## Reference application

The supplied BRISS 0.9 CLI ran successfully with Java 17 against the same generated
six-page fixture, created two parity clusters and retained metadata/bookmarks.
The rebuild's auto-crop heuristic deliberately improves content retention; it is
not an exact reproduction of the old variance heuristic.

## Remaining verification limits

Docker is not installed on this host, so **the Docker image was not built or run**.
The multi-stage Dockerfile, Compose configuration, health check, non-root data
volume and runtime entry point are provided. Source-built production UI/API and
Linux dependency compatibility were verified directly. To perform the remaining
container smoke check, run `docker compose up --build -d` and visit
`http://localhost:8000/api/health` and the browser UI.

The original Swing GUI was inspected statically rather than driven interactively.
Tests use generated PDFs; arbitrary real-world files, complex portfolios, digital
signature validity and full equivalence across every PDF producer are not claimed.
