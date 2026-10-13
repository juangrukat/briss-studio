"""PDF analysis, compositing and non-rasterizing crop export."""

import hashlib
import io
import math
import re
from typing import Any

import numpy as np
import pymupdf as fitz
from PIL import Image

from .models import ExportPlan, Group, GroupOptions, Rect

MAX_PREVIEW = 1100


def parse_pages(value: str, count: int) -> set[int]:
    """Parse strict, inclusive, one-based page ranges."""
    pages: set[int] = set()
    if not value.strip():
        return pages
    for token in value.replace(";", ",").split(","):
        match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", token)
        if not match:
            raise ValueError("Use page numbers or ranges, for example 1, 4-6.")
        start, end = int(match[1]), int(match[2] or match[1])
        if not 1 <= start <= end <= count:
            raise ValueError(f"Page ranges must be between 1 and {count}.")
        pages.update(range(start, end + 1))
    return pages


def groups_for(doc: Any, options: GroupOptions) -> list[Group]:
    """Recover BRISS grouping (20 point buckets and maximum 15 samples)."""
    excluded = parse_pages(options.excludes, len(doc))
    buckets: dict[tuple[int, ...], list[int]] = {}
    for i, page in enumerate(doc):
        number = i + 1
        size = (int(page.rect.width) // 20, int(page.rect.height) // 20)
        key = (
            (number, -1)
            if number in excluded or options.mode == "individual"
            else (*size, number % 2 if options.mode == "parity" else 0)
        )
        buckets.setdefault(key, []).append(number)
    result = []
    for pages in buckets.values():
        p = doc[pages[0] - 1]
        single = pages[0] in excluded or options.mode == "individual"
        label = (
            f"Page {pages[0]}"
            if single
            else (
                ("Odd pages" if pages[0] % 2 else "Even pages")
                if options.mode == "parity"
                else "Same-size pages"
            )
        )
        sample = (
            pages
            if len(pages) <= 15
            else [pages[math.floor(j * len(pages) / 15)] for j in range(15)]
        )
        result.append(
            Group(
                id=hashlib.sha256(",".join(map(str, pages)).encode()).hexdigest()[:16],
                label=label,
                pages=pages,
                samples=sample,
                width=p.rect.width,
                height=p.rect.height,
                individual=single,
            )
        )
    return result


def render_page(page: Any, width: int = MAX_PREVIEW) -> Image.Image:
    """Render bounded previews regardless of physical page size."""
    scale = min(width / page.rect.width, MAX_PREVIEW / page.rect.height, 2)
    pix = page.get_pixmap(
        matrix=fitz.Matrix(scale, scale), alpha=False, colorspace=fitz.csRGB
    )
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def overlay(doc: Any, group: Group) -> Image.Image:
    """Average sampled pages at identical normalized dimensions."""
    accumulator: Any = None
    size: tuple[int, int] | None = None
    for number in group.samples:
        image = render_page(doc[number - 1])
        size = size or image.size
        if image.size != size:
            image = image.resize(size, Image.Resampling.LANCZOS)
        pixels = np.asarray(image, dtype=np.float32)
        accumulator = pixels if accumulator is None else accumulator + pixels
    return Image.fromarray(np.asarray(accumulator / len(group.samples), dtype=np.uint8))


def png(image: Image.Image) -> bytes:
    """Encode a preview for HTTP transport."""
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def detect(doc: Any, group: Group, margin: float = 6, threshold: int = 245) -> Rect:
    """Union content across sampled pages, robust to faint overlay text."""
    bounds: list[tuple[float, float, float, float]] = []
    for number in group.samples:
        image = render_page(doc[number - 1])
        pixels = np.asarray(image)
        mask = pixels.min(axis=2) < threshold
        ys, xs = np.nonzero(mask)
        if len(xs):
            bounds.append(
                (
                    float(xs.min()) / image.width,
                    float(ys.min()) / image.height,
                    float(xs.max() + 1) / image.width,
                    float(ys.max() + 1) / image.height,
                )
            )
    if not bounds:
        return Rect(x=0, y=0, w=1, h=1)
    x0 = max(0, min(b[0] for b in bounds) - margin / group.width)
    y0 = max(0, min(b[1] for b in bounds) - margin / group.height)
    x1 = min(1, max(b[2] for b in bounds) + margin / group.width)
    y1 = min(1, max(b[3] for b in bounds) + margin / group.height)
    return Rect(x=x0, y=y0, w=x1 - x0, h=y1 - y0)


def crop_box(page: Any, region: Rect) -> Any:
    """Transform a displayed crop through rotation and existing cropbox offset."""
    visual = fitz.Rect(
        region.x * page.rect.width,
        region.y * page.rect.height,
        (region.x + region.w) * page.rect.width,
        (region.y + region.h) * page.rect.height,
    )
    box = visual * page.derotation_matrix
    offset = page.cropbox_position
    return fitz.Rect(
        box.x0 + offset.x, box.y0 + offset.y, box.x1 + offset.x, box.y1 + offset.y
    )


def export_pdf(doc: Any, plan: ExportPlan) -> bytes:
    """Copy original PDF pages and change crop boxes; retain selectable vectors."""
    page_rects: dict[int, list[Rect]] = {}
    for group in plan.groups:
        for number in group.pages:
            if number in page_rects or not 1 <= number <= len(doc):
                raise ValueError(
                    "Each source page must occur exactly once in the crop plan."
                )
            page_rects[number] = group.rects
    if set(page_rects) != set(range(1, len(doc) + 1)):
        raise ValueError("The crop plan must include every source page.")
    if sum(max(1, len(r)) for r in page_rects.values()) > 10000:
        raise ValueError("Export is limited to 10,000 output pages.")
    out = fitz.open()
    first: dict[int, int] = {}
    outputs: list[tuple[int, Any]] = []
    try:
        for i, source in enumerate(doc):
            first[i] = len(out)
            regions: list[Rect | None] = list(page_rects[i + 1]) or [None]
            for region in regions:
                box = crop_box(source, region) if region else source.cropbox
                out.insert_pdf(
                    doc,
                    from_page=i,
                    to_page=i,
                    links=False,
                    annots=True,
                    widgets=True,
                    final=0,
                )
                page = out[-1]
                if region:
                    page.set_cropbox(box)
                outputs.append((i, box))
        # PyMuPDF uses an offset-free transformation_matrix on rotated cropboxes.
        # Insert links with pages temporarily unrotated so both source frames and
        # internal destinations use the correct cropbox-to-PDF transform.
        rotations = [p.rotation for p in out]
        for p in out:
            p.set_rotation(0)
        # Internal link destinations must be mapped after split pages are inserted.
        for index, (source_i, box) in enumerate(outputs):
            page = out[index]
            source = doc[source_i]
            # Link rectangles are reported in displayed page coordinates.
            visible = (
                fitz.Rect(
                    box.x0 - source.cropbox.x0,
                    box.y0 - source.cropbox.y0,
                    box.x1 - source.cropbox.x0,
                    box.y1 - source.cropbox.y0,
                )
                * source.rotation_matrix
            )
            for link in source.get_links():
                kind = link["kind"]
                if kind not in (
                    fitz.LINK_URI,
                    fitz.LINK_GOTO,
                    fitz.LINK_GOTOR,
                    fitz.LINK_NAMED,
                    fitz.LINK_LAUNCH,
                ):
                    continue
                frame = link["from"] & visible
                if frame.is_empty:
                    continue
                item = {k: v for k, v in link.items() if k not in ("xref", "id")}
                # insert_link consumes coordinates in unrotated crop-relative space.
                item["from"] = frame * source.derotation_matrix
                item["from"] = fitz.Rect(
                    item["from"].x0 + source.cropbox.x0 - box.x0,
                    item["from"].y0 + source.cropbox.y0 - box.y0,
                    item["from"].x1 + source.cropbox.x0 - box.x0,
                    item["from"].y1 + source.cropbox.y0 - box.y0,
                )
                if kind == fitz.LINK_NAMED and "nameddest" in item:
                    # MuPDF reports resolved symbolic destinations as LINK_NAMED,
                    # but a PDF GoTo action must keep its symbolic destination.
                    item["kind"] = fitz.LINK_GOTO
                    item["page"] = -1
                    item["to"] = item["nameddest"]
                if kind == fitz.LINK_GOTO:
                    target = int(link["page"])
                    if target not in first:
                        continue
                    item["page"] = first[target]
                    target_source = doc[target]
                    dest_box = outputs[first[target]][1]
                    point = (
                        link.get("to", fitz.Point()) * target_source.derotation_matrix
                    )
                    item["to"] = fitz.Point(
                        max(0, point.x + target_source.cropbox.x0 - dest_box.x0),
                        max(0, point.y + target_source.cropbox.y0 - dest_box.y0),
                    )
                page.insert_link(item)
        for p, angle in zip(out, rotations, strict=True):
            p.set_rotation(angle)
        out.set_metadata(doc.metadata)
        source_info = doc.xref_get_key(-1, "Info")
        if source_info[0] == "xref":
            source_xref = int(source_info[1].split()[0])
            target_info = out.xref_get_key(-1, "Info")
            if target_info[0] != "xref":
                info_xref = out.get_new_xref()
                out.update_object(info_xref, "<<>>")
                out.xref_set_key(-1, "Info", f"{info_xref} 0 R")
            else:
                info_xref = int(target_info[1].split()[0])
            for key in doc.xref_get_keys(source_xref):
                kind, value = doc.xref_get_key(source_xref, key)
                if kind in ("string", "name", "int", "float", "bool", "null"):
                    out.xref_set_key(
                        info_xref,
                        key,
                        fitz.get_pdf_str(value) if kind == "string" else value,
                    )
        # Preserve resolved named destinations, mapped to the first split page.
        names = []
        for name, destination in sorted(doc.resolve_names().items()):
            target = destination.get("page", -1)
            if target not in first:
                continue
            target_xref = out.page_xref(first[target])
            point = destination.get("to")
            location = (
                f"/XYZ {point[0]} {point[1]} {destination.get('zoom', 0)}"
                if point
                else "/Fit"
            )
            names.append(f"{fitz.get_pdf_str(name)} [{target_xref} 0 R {location}]")
        if names:
            out.xref_set_key(
                out.pdf_catalog(),
                "Names/Dests",
                "<< /Names [" + " ".join(names) + "] >>",
            )
        if doc.get_xml_metadata():
            out.set_xml_metadata(doc.get_xml_metadata())
        toc = doc.get_toc(simple=False)
        outline_points: dict[int, tuple[int, Any, float]] = {}
        outline_names: dict[int, str] = {}
        for toc_index, entry in enumerate(toc):
            if entry[3].get("kind") == fitz.LINK_NAMED and "nameddest" in entry[3]:
                outline_names[toc_index] = entry[3]["nameddest"]
            if entry[2] > 0:
                original = entry[2] - 1
                entry[2] = first[original] + 1
                destination = entry[3]
                if destination.get("kind") == fitz.LINK_GOTO and "to" in destination:
                    source = doc[original]
                    unrotated = destination["to"] * source.derotation_matrix
                    angle = source.rotation
                    try:
                        source.set_rotation(0)
                        physical = unrotated * ~source.transformation_matrix
                    finally:
                        source.set_rotation(angle)
                    outline_points[toc_index] = (
                        first[original],
                        physical,
                        destination.get("zoom", 0),
                    )
                destination.pop("xref", None)
                destination["page"] = first[original]
                if "to" in destination:
                    source = doc[original]
                    box = outputs[first[original]][1]
                    point = destination["to"] * source.derotation_matrix
                    destination["to"] = (
                        fitz.Point(
                            max(0, point.x + source.cropbox.x0 - box.x0),
                            max(0, point.y + source.cropbox.y0 - box.y0),
                        )
                        * out[first[original]].rotation_matrix
                    )
        if toc:
            out.set_toc(toc)
            # set_toc in this library version omits cropbox offsets and applies
            # rotation inconsistently. Patch GoTo destinations using original PDF
            # coordinates, independent of both crop and rotation transformations.
            outline_refs = out.get_outline_xrefs()
            for index, (target, physical, zoom) in outline_points.items():
                reference = out.page_xref(target)
                out.xref_set_key(outline_refs[index], "Dest", "null")
                out.xref_set_key(
                    outline_refs[index],
                    "A",
                    f"<< /S /GoTo /D [{reference} 0 R /XYZ {physical.x} {physical.y} {zoom}] >>",
                )
            for index, name in outline_names.items():
                out.xref_set_key(outline_refs[index], "Dest", "null")
                out.xref_set_key(
                    outline_refs[index],
                    "A",
                    f"<< /S /GoTo /D {fitz.get_pdf_str(name)} >>",
                )
        # Match BRISS physical-page sizing as well as the visible crop. Set raw
        # PDF boxes after destinations are written, preserving content coordinates.
        for index, (original, _) in enumerate(outputs):
            if page_rects[original + 1]:
                reference = out[index].xref
                _, raw_box = out.xref_get_key(reference, "CropBox")
                out.xref_set_key(reference, "MediaBox", raw_box)
                for optional in ("TrimBox", "BleedBox", "ArtBox"):
                    out.xref_set_key(reference, optional, "null")
        return bytes(out.tobytes(garbage=3, deflate=True))
    finally:
        out.close()


def demo_pdf() -> bytes:
    """Generate a real six-page PDF to exercise the editor without an upload."""
    doc = fitz.open()
    for i in range(6):
        p = doc.new_page(width=595, height=842)
        left = 76 if i % 2 == 0 else 52
        p.draw_rect(
            fitz.Rect(left, 75, left + 440, 78), color=None, fill=(0.13, 0.36, 0.29)
        )
        p.insert_text(
            (left, 60),
            "FIELD NOTES  /  THE SLOW STUDIO",
            fontsize=9,
            color=(0.25, 0.4, 0.34),
        )
        p.insert_text(
            (left, 130),
            [
                "Make room for what matters",
                "A little less, a little better",
                "The shape of a good idea",
            ][i % 3],
            fontsize=22,
            color=(0.08, 0.23, 0.18),
        )
        for column in range(2):
            x = left + column * 230
            text = (
                "Good work begins with a clear space.\n\nWhen we remove the unnecessary,\nwe give useful ideas room to grow.\nA margin is a small invitation to pause.\n\nLook closely. Leave a little breathing\nroom. Keep the details that matter.\n\nThis is a sample document for exploring\nprecise crops and two-column layouts.\nTry a separate region for each column.\n\nYour words stay sharp and selectable.\nThe original pages keep their order.\n\n"
                * 2
            )
            p.insert_textbox(
                fitz.Rect(x, 170, x + 210, 680),
                text,
                fontsize=10,
                lineheight=1.5,
                color=(0.25, 0.29, 0.27),
            )
        p.insert_text(
            (left, 750),
            f"BRISS STUDIO                                      FIELD NOTES / {i+1:02}",
            fontsize=9,
        )
    doc.set_metadata({"title": "Field notes", "author": "BRISS Studio"})
    doc.set_toc([[1, "Make room", 1], [1, "A little better", 3], [1, "A good idea", 5]])
    data = bytes(doc.tobytes())
    doc.close()
    return data
