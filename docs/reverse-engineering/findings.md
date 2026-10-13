# BRISS 0.9 investigation

## Evidence and boundaries

Target: `/Users/kat/BR/briss-0.9.jar`, SHA-256
`3b61a6bdb13cadb006ea97873886a90b70572793883b5451ccb9e3e913aaa5c8`.
REA inventory evidence:
`ev_7ee01c0bf38bd5e4c1e230f8c7bb8255ebe1a7f3edae2f79cf5c4935d9d933e5`;
inspection evidence:
`ev_68abb75c63712b055cf1bbb4ff3b68d34a356d471267733ba6ff4702850c5f50`.
Complete retained archive inventory is in `artifact-evidence.json`.

`javap -p -c` recovered the packaged Java bytecode in `briss-bytecode.txt`.
Conclusions below derive from bytecode and bundled readme/changelog/help. The REA
archive classifier identifies CAFEBABE Java class headers as Mach-O universal;
this is a format-classification limitation, not evidence of native Mach-O code.
The valid JVM bytecode was independently decoded with javap.

The original headless command-line application was executed on the generated
six-page Field Notes fixture with Java 17 and the supplied dependency jars:
`java -Djava.awt.headless=true -jar briss-0.9.jar -s tmp/reference/source.pdf -d tmp/reference/original-auto.pdf`.
It created two clusters and exported six pages, retaining the title and all three
bookmarks. Desktop Swing pointer behavior was inspected statically, not tested
interactively on the original application.

## Recovered features and implementation mapping

| Reference behavior | Evidence location | Rebuild |
| --- | --- | --- |
| Load/drop PDF | BrissGUI / BrissTransferHandler / readme | Upload/drop + password entry |
| Parity and dimension grouping | PageCluster.isClusterNearlyEqual | `groups_for`, original 20 pt buckets |
| Excluded pages never merge | PageCluster.excluded | Individual editable groups |
| Up to 15 pages sampled | PageCluster.choosePagesToMerge | Same evenly spaced sampling |
| Groups sorted by first source page | PageCluster.compareTo | Insertion order while walking source pages |
| Similar pages overlaid | ClusterImageData / help | Bounded normalized pixel averaging |
| Automatic crop | CropFinder / BrissCMD | Content union + adjustable padding and threshold |
| Multiple regions create pages | DocumentCropper.copyToMultiplePages | Page copies in source and region order |
| Empty crop lists keep pages | DocumentCropper.cropMultipliedFile | Retain original page box |
| Drag and corner resize | MergedPanel / readme / changelog | Pointer canvas with eight handles |
| Multi-selection and deletion | BrissGUI / MergedPanel | Shift/Ctrl/Cmd click + Delete |
| Copy/paste across clusters | ClipBoard / help | Editor clipboard and shortcuts |
| Exact position/size (mm) | BrissGUI.setSize/setPosition | Numeric inspector in pt/mm/in |
| Max width, height and all sizes | BrissGUI action dispatch | Selected match buttons / match all |
| Move selected regions | BrissGUI menu / MergedPanel | Drag and arrow keys, Shift = 10 pt |
| Reload with new exclusions retaining crops | BrissGUI.reloadFile | Regroup with page-associated inheritance |
| Preview output | DocumentCropper + BrissGUI | PDF.js uses exact exported PDF |
| Metadata/bookmarks/named destinations | DocumentCropper | Standard/custom/XMP metadata + destination remapping |
| Rotated PDFs | RectangleHandler | Display → unrotated cropbox transformations |
| CLI `-s` / `-d`, default `_cropped.pdf` | BrissCMD | Python CLI, plus overwrite protection |

## Deliberate improvements

Browser/server separation, Docker packaging, a new interface, undo/redo, explicit
region order, zoom, individual-page inspection, recipe validation, optional access
gate, bounded sessions, and restart-safe manifests are new design choices.
Donation/menu look-and-feel and desktop file-history integration are replaced by
web navigation and current-session restoration rather than reproduced.

Auto detection preserves the capability, not the historical variance heuristic.
On the Field Notes fixture the old algorithm cropped to approximately 272 × 34 pt,
clipping most content. The rebuild detected approximately 453 × 710 pt with 6 pt
padding, enclosing headers, text columns and footers. This is one observed test
fixture, not a claim about all documents. Scan noise and dark backgrounds may
require manual crop adjustment. Only sampled pages contribute to auto detection;
individual-page inspection and individual grouping are available for exceptions.

The legacy cropper changes MediaBox and CropBox; the rebuild does too. Coordinate behavior is verified
through pixel regression cases rather than copied from its desktop renderer.
PDF-library documentation used for cropbox/rotation and named destinations:
https://pymupdf.readthedocs.io/en/latest/page.html and
https://pymupdf.readthedocs.io/en/latest/document.html.
