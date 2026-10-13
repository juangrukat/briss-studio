import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfPreview({ url }: { url: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [number, setNumber] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(700),
    container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const loadingTask = getDocument({
      url,
      cMapUrl: "/pdf-assets/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdf-assets/standard_fonts/",
      wasmUrl: "/pdf-assets/wasm/",
    });
    let stopped = false;
    loadingTask.promise
      .then((d) => {
        if (!stopped) setDoc(d);
      })
      .catch((e) => {
        if (!stopped) {
          setError(String(e));
          setLoading(false);
        }
      });
    return () => {
      stopped = true;
      void loadingTask.destroy();
    };
  }, [url]);
  useEffect(() => {
    const el = container.current!;
    const observer = new ResizeObserver(() =>
      setWidth(Math.min(1000, el.clientWidth - 60)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!doc) return;
    let cancelled = false,
      render: RenderTask | undefined;
    setLoading(true);
    setError("");
    doc
      .getPage(number)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const base = p.getViewport({ scale: 1 });
        const scale = Math.max(100, width) / base.width;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: scale * ratio });
        const el = canvas.current;
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        el.style.width = `${viewport.width / ratio}px`;
        el.style.height = `${viewport.height / ratio}px`;
        render = p.render({ canvas: el, viewport });
        return render.promise;
      })
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(
            "The preview could not render this page. You can still download the PDF.",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, number, width]);
  return (
    <div className="pdf-preview">
      <nav className="preview-pagination" aria-label="PDF preview pages">
        <button
          aria-label="Previous output page"
          disabled={number === 1 || !doc}
          onClick={() => setNumber((n) => n - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <label>
          Page{" "}
          <input
            type="number"
            aria-label="Output page number"
            value={number}
            min="1"
            max={doc?.numPages ?? 1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= (doc?.numPages ?? 1))
                setNumber(n);
            }}
          />{" "}
          of {doc?.numPages ?? "…"}
        </label>
        <button
          aria-label="Next output page"
          disabled={!doc || number === doc.numPages}
          onClick={() => setNumber((n) => n + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <span>Exact export · original PDF quality</span>
      </nav>
      <div className="pdf-pages" ref={container}>
        {loading && (
          <div className="pdf-loading" role="status">
            <Loader2 size={20} className="spin" />
            Rendering preview…
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <canvas
          ref={canvas}
          aria-label={`Preview of output page ${number}`}
          style={{ visibility: loading || error ? "hidden" : "visible" }}
        />
      </div>
    </div>
  );
}
