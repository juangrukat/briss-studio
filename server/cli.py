"""Batch-compatible automatic cropping: python -m server.cli -s input.pdf."""

import argparse
import getpass
from pathlib import Path

import pymupdf as fitz

from .models import ExportPlan, GroupOptions, PagePlan
from .pdf import detect, export_pdf, groups_for


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Automatically crop PDF margins without rasterizing pages."
    )
    parser.add_argument("-s", "--source", type=Path, required=True)
    parser.add_argument("-d", "--destination", type=Path)
    parser.add_argument(
        "--margin", type=float, default=6, help="Padding in PDF points, 0-72"
    )
    parser.add_argument(
        "--exclude", default="", help="Individually process these pages, e.g. 1,4-6"
    )
    parser.add_argument(
        "--group", choices=["parity", "size", "individual"], default="parity"
    )
    args = parser.parse_args()
    target = args.destination or args.source.with_name(
        args.source.stem + "_cropped.pdf"
    )
    if target.resolve() == args.source.resolve():
        parser.error("Destination must differ from the source PDF.")
    if target.exists():
        parser.error("Destination already exists; choose a new filename.")
    if not 0 <= args.margin <= 72:
        parser.error("Margin must be between 0 and 72 points.")
    try:
        with fitz.open(args.source) as doc:
            if doc.needs_pass and not doc.authenticate(
                getpass.getpass("PDF password: ")
            ):
                parser.error("Invalid PDF password.")
            groups = groups_for(
                doc, GroupOptions(mode=args.group, excludes=args.exclude)
            )
            plan = ExportPlan(
                groups=[
                    PagePlan(pages=g.pages, rects=[detect(doc, g, args.margin)])
                    for g in groups
                ]
            )
            target.write_bytes(export_pdf(doc, plan))
        print(target)
    except (ValueError, OSError, RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
