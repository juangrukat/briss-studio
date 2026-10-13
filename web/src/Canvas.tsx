import { useRef, useState, useEffect } from "react";
import type { PointerEvent as PE } from "react";
import type { Group, Rect } from "./types";
import { clamp, fromPoints, bounded, uid } from "./geometry";

type Props = {
  group: Group;
  session: string;
  rects: Rect[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  onChange: (rects: Rect[]) => void;
  tool: "select" | "draw";
  zoom: number;
  page: number | null;
};
export function Canvas({
  group,
  session,
  rects,
  selected,
  onSelect,
  onChange,
  tool,
  zoom,
  page,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 700 }),
    [draft, setDraft] = useState<Rect[] | null>(null),
    [loaded, setLoaded] = useState(false),
    [imageError, setImageError] = useState(false);
  const drag = useRef<{
    start: { x: number; y: number };
    base: Rect[];
    id: string;
    kind: string;
  } | null>(null);
  const url = page
    ? `/api/documents/${session}/pages/${page}/image`
    : `/api/documents/${session}/groups/${group.id}/image`;
  useEffect(() => {
    setLoaded(false);
    setImageError(false);
    setDraft(null);
    drag.current = null;
  }, [url]);
  useEffect(() => {
    const el = wrap.current!;
    const observer = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const shown = draft ?? rects;
  const width =
    Math.max(
      140,
      Math.min(size.w - 96, ((size.h - 100) * group.width) / group.height),
    ) * zoom;
  const point = (event: PE) => {
    const box = canvas.current!.getBoundingClientRect();
    return {
      x: clamp((event.clientX - box.left) / box.width),
      y: clamp((event.clientY - box.top) / box.height),
    };
  };
  function start(event: PE, id?: string, kind = "move") {
    if (event.button !== 0 || !loaded) return;
    event.preventDefault();
    event.stopPropagation();
    const p = point(event);
    if (id && tool === "select") {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {
        onSelect(
          selected.includes(id)
            ? selected.filter((x) => x !== id)
            : [...selected, id],
        );
        return;
      }
      if (!selected.includes(id)) onSelect([id]);
      drag.current = { start: p, base: rects.map((r) => ({ ...r })), id, kind };
    } else if (tool === "draw") {
      if (rects.length >= 32) return;
      const newId = uid();
      drag.current = {
        start: p,
        base: rects.map((r) => ({ ...r })),
        id: newId,
        kind: "draw",
      };
      onSelect([newId]);
    } else {
      onSelect([]);
      return;
    }
    canvas.current!.setPointerCapture(event.pointerId);
  }
  function move(event: PE) {
    const d = drag.current;
    if (!d) return;
    const p = point(event);
    const dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if (d.kind === "draw") {
      const r = fromPoints(d.start, p);
      setDraft([...d.base, { ...r, id: d.id }]);
      return;
    }
    const target = d.base.find((r) => r.id === d.id)!;
    if (d.kind === "move") {
      const ids = selected.includes(d.id) ? selected : [d.id];
      const chosen = d.base.filter((r) => ids.includes(r.id));
      const mx = clamp(
        dx,
        -Math.min(...chosen.map((r) => r.x)),
        1 - Math.max(...chosen.map((r) => r.x + r.w)),
      );
      const my = clamp(
        dy,
        -Math.min(...chosen.map((r) => r.y)),
        1 - Math.max(...chosen.map((r) => r.y + r.h)),
      );
      setDraft(
        d.base.map((r) =>
          ids.includes(r.id) ? { ...r, x: r.x + mx, y: r.y + my } : r,
        ),
      );
      return;
    }
    const left = d.kind.includes("w")
      ? clamp(target.x + dx, 0, target.x + target.w - 0.001)
      : target.x;
    const top = d.kind.includes("n")
      ? clamp(target.y + dy, 0, target.y + target.h - 0.001)
      : target.y;
    const right = d.kind.includes("e")
      ? clamp(target.x + target.w + dx, target.x + 0.001, 1)
      : target.x + target.w;
    const bottom = d.kind.includes("s")
      ? clamp(target.y + target.h + dy, target.y + 0.001, 1)
      : target.y + target.h;
    setDraft(
      d.base.map((r) =>
        r.id === d.id
          ? bounded({ ...r, x: left, y: top, w: right - left, h: bottom - top })
          : r,
      ),
    );
  }
  function finish() {
    if (drag.current && draft) {
      const next = draft.filter((r) => r.w > 0.002 && r.h > 0.002);
      onChange(next);
    }
    drag.current = null;
    setDraft(null);
  }
  return (
    <div className="canvas-area" ref={wrap}>
      <div className="paper-wrap" style={{ width, margin: "auto" }}>
        <div
          ref={canvas}
          className={`paper tool-${tool}`}
          style={{ aspectRatio: `${group.width}/${group.height}` }}
          onPointerDown={(e) => start(e)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={() => {
            drag.current = null;
            setDraft(null);
          }}
        >
          <img
            src={url}
            alt={
              page ? `Page ${page}` : `Overlay of ${group.samples.length} pages`
            }
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setImageError(true)}
          />
          {!loaded && (
            <div className="canvas-loading">
              {imageError
                ? "Preview unavailable. Reload the document."
                : "Rendering page overlay…"}
            </div>
          )}
          <svg
            className="mask"
            viewBox="0 0 1000 1000"
            preserveAspectRatio="none"
          >
            <defs>
              <mask id="outside">
                <rect width="1000" height="1000" fill="white" />
                {shown.map((r) => (
                  <rect
                    key={r.id}
                    x={r.x * 1000}
                    y={r.y * 1000}
                    width={r.w * 1000}
                    height={r.h * 1000}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
            {shown.length > 0 && (
              <rect
                width="1000"
                height="1000"
                fill="#173c35"
                opacity=".15"
                mask="url(#outside)"
              />
            )}
          </svg>
          {shown.map((r, i) => (
            <div
              key={r.id}
              className={`crop-box ${selected.includes(r.id) ? "selected" : ""}`}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
              }}
              onPointerDown={(e) => start(e, r.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onSelect([r.id]);
              }}
            >
              <span className="crop-label">
                {i + 1}
                <span>
                  {Math.round(r.w * group.width)} ×{" "}
                  {Math.round(r.h * group.height)} pt
                </span>
              </span>
              {selected.includes(r.id) &&
                (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(
                  (k) => (
                    <span
                      key={k}
                      className={`handle ${k}`}
                      onPointerDown={(e) => start(e, r.id, k)}
                    />
                  ),
                )}
            </div>
          ))}
        </div>
        <div className="paper-caption">
          {Math.round(group.width)} × {Math.round(group.height)} pt{" "}
          <span>•</span>{" "}
          {page
            ? `Original page ${page}`
            : `${group.samples.length} pages overlaid`}
        </div>
      </div>
    </div>
  );
}
