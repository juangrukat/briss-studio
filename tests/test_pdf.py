import io
import subprocess
import sys
from pathlib import Path
import numpy as np
import pymupdf as f
import pytest
from PIL import Image
from server.models import ExportPlan, Group, GroupOptions, PagePlan, Rect
from server.pdf import (
    crop_box,
    demo_pdf,
    detect,
    export_pdf,
    groups_for,
    overlay,
    parse_pages,
    png,
    render_page,
)


@pytest.fixture
def doc():
    d = f.open()
    for n in range(4):
        p = d.new_page(width=400, height=600)
        p.insert_text((50, 100), f"LEFT PAGE {n+1}", fontsize=16)
        p.insert_text((230, 100), f"RIGHT PAGE {n+1}", fontsize=16)
        p.draw_rect(f.Rect(50, 130, 150, 210), fill=(0.1, 0.6, 0.3))
    d.set_metadata({"title": "Crop regression", "author": "Test author"})
    d.set_xml_metadata("<metadata>retained</metadata>")
    d.set_toc([[1, "First", 1], [2, "Second", 2], [1, "Last", 4]])
    d[0].insert_link(
        {
            "kind": f.LINK_GOTO,
            "from": f.Rect(50, 70, 130, 100),
            "page": 3,
            "to": f.Point(50, 80),
        }
    )
    d[0].insert_link(
        {
            "kind": f.LINK_URI,
            "from": f.Rect(50, 140, 150, 160),
            "uri": "https://example.com/",
        }
    )
    annot = d[1].add_text_annot((60, 180), "Keep me")
    annot.update()
    data = d.tobytes()
    d.close()
    with f.open(stream=data, filetype="pdf") as opened:
        yield opened


def plan(d, regions):
    return ExportPlan(
        groups=[PagePlan(pages=list(range(1, len(d) + 1)), rects=regions)]
    )


@pytest.mark.parametrize(
    "value,expected",
    [("", set()), ("1, 3-5", {1, 3, 4, 5}), ("2,2", {2}), (" 1 ", {1})],
)
def test_ranges(value, expected):
    assert parse_pages(value, 6) == expected


@pytest.mark.parametrize("value", ["0", "7", "4-2", "1-", "a", "1,,2", "-1", "1.5"])
def test_bad_ranges(value):
    with pytest.raises(ValueError):
        parse_pages(value, 6)


@pytest.mark.parametrize(
    "values",
    [
        dict(x=0.5, y=0, w=0.6, h=1),
        dict(x=-1, y=0, w=1, h=1),
        dict(x=0, y=0, w=0, h=1),
        dict(x=float("nan"), y=0, w=1, h=1),
    ],
)
def test_rect_validation(values):
    with pytest.raises(ValueError):
        Rect(**values)


def test_grouping_excludes_and_samples(doc):
    groups = groups_for(doc, GroupOptions())
    assert [g.pages for g in groups] == [[1, 3], [2, 4]]
    assert [g.pages for g in groups_for(doc, GroupOptions(excludes="1"))] == [
        [1],
        [2, 4],
        [3],
    ]
    assert groups_for(doc, GroupOptions(excludes="1"))[0].individual
    assert len(groups_for(doc, GroupOptions(mode="size"))) == 1
    assert len(groups_for(doc, GroupOptions(mode="individual"))) == 4
    for _ in range(40):
        doc.new_page(width=400, height=600)
    assert all(len(g.samples) == 15 for g in groups_for(doc, GroupOptions()))
    assert len(set(groups_for(doc, GroupOptions())[0].samples)) == 15


def test_dimension_buckets():
    d = f.open()
    for w in (401, 401, 419, 421):
        d.new_page(width=w, height=600)
    assert [g.pages for g in groups_for(d, GroupOptions(mode="size"))] == [
        [1, 2, 3],
        [4],
    ]
    d.close()


def test_split_preserves_order_content_metadata_and_outlines(doc):
    p = plan(doc, [Rect(x=0, y=0, w=0.5, h=1), Rect(x=0.5, y=0, w=0.5, h=1)])
    with f.open(stream=export_pdf(doc, p), filetype="pdf") as out:
        assert len(out) == 8
        assert out[0].rect.width == 200
        for i in range(4):
            assert f"LEFT PAGE {i+1}" in out[2 * i].get_text()
            assert f"RIGHT PAGE {i+1}" in out[2 * i + 1].get_text()
            assert "RIGHT PAGE" not in out[2 * i].get_text()
        assert out.metadata["title"] == "Crop regression"
        assert out.metadata["author"] == "Test author"
        assert out.get_xml_metadata() == "<metadata>retained</metadata>"
        assert out.get_toc() == [[1, "First", 1], [2, "Second", 3], [1, "Last", 7]]
        assert len(list(out[2].annots())) == 1
        links = out[0].get_links()
        assert next(x for x in links if x["kind"] == f.LINK_GOTO)["page"] == 6
        assert (
            next(x for x in links if x["kind"] == f.LINK_URI)["uri"]
            == "https://example.com/"
        )
        assert not out[1].get_links()


def test_empty_regions_retain_original_pages(doc):
    with f.open(stream=export_pdf(doc, plan(doc, [])), filetype="pdf") as out:
        assert len(out) == 4 and out[0].rect == doc[0].rect


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
@pytest.mark.parametrize("existing_crop", [False, True])
def test_rotation_and_existing_cropbox_render_exact_content(angle, existing_crop):
    d = f.open()
    p = d.new_page(width=400, height=600)
    p.draw_rect(f.Rect(30, 40, 180, 260), fill=(1, 0, 0), color=None)
    p.draw_rect(f.Rect(220, 300, 380, 580), fill=(0, 0, 1), color=None)
    if existing_crop:
        p.set_cropbox(f.Rect(20, 30, 390, 590))
    p.set_rotation(angle)
    r = Rect(x=0.15, y=0.2, w=0.6, h=0.5)
    original = p.get_pixmap(matrix=f.Matrix(1, 1), alpha=False)
    image = Image.frombytes("RGB", (original.width, original.height), original.samples)
    expected = image.crop(
        (
            round(r.x * image.width),
            round(r.y * image.height),
            round((r.x + r.w) * image.width),
            round((r.y + r.h) * image.height),
        )
    )
    with f.open(stream=export_pdf(d, plan(d, [r])), filetype="pdf") as out:
        q = out[0]
        pix = q.get_pixmap(matrix=f.Matrix(1, 1), alpha=False)
        actual = Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize(
            expected.size
        )
        assert abs(q.rect.width - p.rect.width * r.w) < 0.01
        assert abs(q.rect.height - p.rect.height * r.h) < 0.01
        assert (
            np.abs(
                np.asarray(actual, dtype=float) - np.asarray(expected, dtype=float)
            ).mean()
            < 2
        )
    d.close()


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_rotated_link_frames(angle):
    d = f.open()
    p = d.new_page(width=400, height=600)
    p.insert_link(
        {
            "kind": f.LINK_URI,
            "from": f.Rect(100, 150, 180, 180),
            "uri": "https://example.com/",
        }
    )
    p.set_rotation(angle)
    data = d.tobytes()
    d.close()
    d = f.open(stream=data, filetype="pdf")
    p = d[0]
    r = Rect(x=0.05, y=0.05, w=0.9, h=0.9)
    original = p.get_links()[0]["from"]
    with f.open(stream=export_pdf(d, plan(d, [r])), filetype="pdf") as out:
        actual = out[0].get_links()[0]["from"]
        assert actual.x0 == pytest.approx(original.x0 - p.rect.width * 0.05, abs=0.01)
        assert actual.y0 == pytest.approx(original.y0 - p.rect.height * 0.05, abs=0.01)
    d.close()


def test_auto_overlay_blank_and_padding(doc):
    group = groups_for(doc, GroupOptions())[0]
    r = detect(doc, group, margin=0)
    padded = detect(doc, group, margin=10)
    assert 0 < r.x < 0.2 and 0.05 < r.y < 0.2
    assert padded.x < r.x and padded.w > r.w
    image = overlay(doc, group)
    assert image.width <= 1100 and image.height <= 1100
    assert png(image).startswith(b"\x89PNG")
    blank = f.open()
    blank.new_page()
    g = groups_for(blank, GroupOptions())[0]
    assert detect(blank, g) == Rect(x=0, y=0, w=1, h=1)
    blank.close()


@pytest.mark.parametrize(
    "groups",
    [
        [PagePlan(pages=[1], rects=[])],
        [PagePlan(pages=[1, 1, 2, 3, 4], rects=[])],
        [PagePlan(pages=[1, 2, 3, 5], rects=[])],
    ],
)
def test_plan_rejects_missing_duplicate_and_out_of_range(doc, groups):
    with pytest.raises(ValueError):
        export_pdf(doc, ExportPlan(groups=groups))


def test_demo_and_cli(tmp_path):
    path = tmp_path / "sample.pdf"
    path.write_bytes(demo_pdf())
    result = subprocess.run(
        [sys.executable, "-m", "server.cli", "-s", str(path)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    with f.open(tmp_path / "sample_cropped.pdf") as out:
        assert len(out) == 6 and out[0].rect.width < 595
    again = subprocess.run(
        [sys.executable, "-m", "server.cli", "-s", str(path)],
        capture_output=True,
        text=True,
    )
    assert again.returncode != 0 and "already exists" in again.stderr
    same = subprocess.run(
        [sys.executable, "-m", "server.cli", "-s", str(path), "-d", str(path)],
        capture_output=True,
        text=True,
    )
    assert same.returncode != 0 and "differ" in same.stderr


def test_cli_validation_in_process(tmp_path, monkeypatch, capsys):
    from server.cli import main

    source = tmp_path / "demo.pdf"
    source.write_bytes(demo_pdf())
    dest = tmp_path / "out.pdf"
    monkeypatch.setattr(
        sys, "argv", ["briss", "-s", str(source), "-d", str(dest), "--group", "size"]
    )
    main()
    assert dest.exists()
    for args in (
        ["-s", str(source), "-d", str(source)],
        ["-s", str(source), "-d", str(dest)],
        ["-s", str(source), "--margin", "99"],
        ["-s", str(tmp_path / "missing.pdf")],
    ):
        monkeypatch.setattr(sys, "argv", ["briss", *args])
        with pytest.raises(SystemExit) as error:
            main()
        assert error.value.code == 2
    locked = f.open(stream=demo_pdf(), filetype="pdf")
    source.write_bytes(
        locked.tobytes(
            encryption=f.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner"
        )
    )
    locked.close()
    monkeypatch.setattr("getpass.getpass", lambda prompt: "bad")
    monkeypatch.setattr(sys, "argv", ["briss", "-s", str(source)])
    with pytest.raises(SystemExit):
        main()


def test_custom_metadata_and_named_destination_remapping(doc):
    info = int(doc.xref_get_key(-1, "Info")[1].split()[0])
    doc.xref_set_key(info, "CustomProject", f.get_pdf_str("Archive A"))
    ref = doc.page_xref(3)
    doc.xref_set_key(
        doc.pdf_catalog(),
        "Names/Dests",
        f"<< /Names [(chapter-last) [{ref} 0 R /XYZ 50 500 0]] >>",
    )
    with f.open(
        stream=export_pdf(
            doc, plan(doc, [Rect(x=0, y=0, w=0.5, h=1), Rect(x=0.5, y=0, w=0.5, h=1)])
        ),
        filetype="pdf",
    ) as out:
        xref = int(out.xref_get_key(-1, "Info")[1].split()[0])
        assert out.xref_get_key(xref, "CustomProject") == ("string", "Archive A")
        assert out.resolve_names()["chapter-last"]["page"] == 6
        assert out.resolve_names()["chapter-last"]["to"] == (50, 500)


@pytest.mark.parametrize("angle", [0, 90, 180, 270])
def test_rotated_bookmark_destination(doc, angle):
    for p in doc:
        p.set_rotation(angle)
    doc.set_toc(
        [
            [
                1,
                "First",
                1,
                {"kind": f.LINK_GOTO, "page": 0, "to": f.Point(100, 150), "zoom": 1},
            ]
        ]
    )
    original = doc.get_toc(simple=False)[0][3]["to"]
    r = Rect(x=0.05, y=0.05, w=0.9, h=0.9)
    with f.open(stream=export_pdf(doc, plan(doc, [r])), filetype="pdf") as out:
        dest = out.get_toc(simple=False)[0][3]["to"]
        assert dest.x == pytest.approx(original.x - doc[0].rect.width * 0.05, abs=0.01)
        assert dest.y == pytest.approx(original.y - doc[0].rect.height * 0.05, abs=0.01)


def test_export_sets_physical_media_size_to_crop(doc):
    with f.open(
        stream=export_pdf(doc, plan(doc, [Rect(x=0.1, y=0.2, w=0.6, h=0.5)])),
        filetype="pdf",
    ) as out:
        assert out[0].mediabox.width == pytest.approx(240)
        assert out[0].mediabox.height == pytest.approx(300)


def test_form_widget_survives_crop():
    d = f.open()
    p = d.new_page(width=400, height=600)
    w = f.Widget()
    w.field_name = "Note"
    w.field_type = f.PDF_WIDGET_TYPE_TEXT
    w.field_value = "Retained value"
    w.rect = f.Rect(60, 100, 180, 130)
    p.add_widget(w)
    with f.open(
        stream=export_pdf(d, plan(d, [Rect(x=0.1, y=0.1, w=0.8, h=0.8)])),
        filetype="pdf",
    ) as out:
        widgets = list(out[0].widgets())
        assert len(widgets) == 1 and widgets[0].field_value == "Retained value"
        assert widgets[0].rect.x0 == pytest.approx(20)
        assert widgets[0].rect.y0 == pytest.approx(40)
    d.close()


def test_named_internal_link_is_preserved(doc):
    reference = doc.page_xref(3)
    doc.xref_set_key(
        doc.pdf_catalog(),
        "Names/Dests",
        f"<< /Names [(last) [{reference} 0 R /XYZ 50 500 0]] >>",
    )
    doc[0].insert_link(
        {
            "kind": f.LINK_GOTO,
            "from": f.Rect(50, 220, 160, 240),
            "page": -1,
            "to": "last",
        }
    )
    data = doc.tobytes()
    with f.open(stream=data, filetype="pdf") as source:
        with f.open(
            stream=export_pdf(
                source,
                plan(
                    source, [Rect(x=0, y=0, w=0.5, h=1), Rect(x=0.5, y=0, w=0.5, h=1)]
                ),
            ),
            filetype="pdf",
        ) as out:
            links = out[0].get_links()
            assert any(
                link.get("page") == 6 and abs(link["from"].y0 - 220) < 0.01
                for link in links
            )


def test_named_bookmark_is_preserved(doc):
    reference = doc.page_xref(3)
    doc.xref_set_key(
        doc.pdf_catalog(),
        "Names/Dests",
        f"<< /Names [(last) [{reference} 0 R /XYZ 50 500 0]] >>",
    )
    doc.set_toc([[1, "Named last chapter", 4]])
    doc.xref_set_key(doc.get_outline_xrefs()[0], "A", "<< /S /GoTo /D (last) >>")
    with f.open(stream=doc.tobytes(), filetype="pdf") as source:
        with f.open(
            stream=export_pdf(
                source,
                plan(
                    source, [Rect(x=0, y=0, w=0.5, h=1), Rect(x=0.5, y=0, w=0.5, h=1)]
                ),
            ),
            filetype="pdf",
        ) as out:
            toc = out.get_toc(simple=False)
            assert toc[0][2] == 7
            assert toc[0][3]["nameddest"] == "last"
