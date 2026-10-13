import { useState, useEffect, useRef, lazy, Suspense } from "react";
import type { ReactNode } from "react";
import {
  Crop,
  Upload,
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  ChevronDown,
  Plus,
  Minus,
  MousePointer2,
  SquareDashed,
  ScanLine,
  Undo2,
  Redo2,
  Copy,
  ClipboardPaste,
  Trash2,
  Download,
  Eye,
  X,
  Settings2,
  Keyboard,
  FileText,
  Check,
  Loader2,
  Layers,
  Maximize2,
  PanelLeftClose,
  LockKeyhole,
  MoveHorizontal,
  MoveVertical,
  Save,
  FolderOpen,
} from "lucide-react";
import type { Document, Rect, Crops, Options, Recipe } from "./types";
import { Canvas } from "./Canvas";
const PdfPreview = lazy(() =>
  import("./PdfPreview").then((m) => ({ default: m.PdfPreview })),
);
import { api, json, download } from "./api";
import { bounded, full, transfer, uid, validateRecipe } from "./geometry";

type History = { past: Crops[]; present: Crops; future: Crops[] };
function IconButton({
  title,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  title: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
const empty: History = { past: [], present: {}, future: [] };
export default function App() {
  const [doc, setDoc] = useState<Document | null>(null),
    [groupId, setGroupId] = useState(""),
    [history, setHistory] = useState<History>(empty),
    [selected, setSelected] = useState<string[]>([]),
    [tool, setTool] = useState<"select" | "draw">("select"),
    [zoom, setZoom] = useState(1),
    [page, setPage] = useState<number | null>(null);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [modal, setModal] = useState<
      "settings" | "help" | "password" | "auth" | null
    >(null),
    [preview, setPreview] = useState(""),
    [drop, setDrop] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 850);
  const [options, setOptions] = useState<Options>({
      mode: "parity",
      excludes: "",
    }),
    [margin, setMargin] = useState(6),
    [threshold, setThreshold] = useState(245),
    [unit, setUnit] = useState<"pt" | "mm" | "in">("pt"),
    [password, setPassword] = useState(""),
    [authToken, setAuthToken] = useState(""),
    [limit, setLimit] = useState(100);
  const input = useRef<HTMLInputElement>(null),
    recipeInput = useRef<HTMLInputElement>(null),
    pendingFile = useRef<File | null>(null),
    clipboard = useRef<Rect[]>([]);
  const group = doc?.groups.find((g) => g.id === groupId) ?? doc?.groups[0];
  const crops = history.present;
  const rects = group ? (crops[group.id] ?? []) : [];
  const all = Object.values(crops).flat();
  const chosen = all.filter((r) => selected.includes(r.id));
  const active = chosen[0];
  const outputCount =
    doc?.groups.reduce(
      (sum, g) =>
        sum + g.pages.length * Math.max(1, (crops[g.id] ?? []).length),
      0,
    ) ?? 0;
  function commit(next: Crops) {
    setHistory((h) => ({
      past: [...h.past, h.present].slice(-80),
      present: next,
      future: [],
    }));
  }
  function undo() {
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past[h.past.length - 1],
            future: [h.present, ...h.future],
          }
        : h,
    );
    setSelected([]);
  }
  function redo() {
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0],
            future: h.future.slice(1),
          }
        : h,
    );
    setSelected([]);
  }
  async function work(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  function recipe(): Recipe {
    return {
      version: 1,
      fingerprint: doc!.fingerprint,
      options: doc!.options,
      groups: doc!.groups.map((g) => ({
        pages: g.pages,
        rects: (crops[g.id] ?? []).map(({ id, ...r }) => r),
      })),
    };
  }
  useEffect(() => {
    api<{
      auth_required: boolean;
      authenticated: boolean;
      max_upload_mb: number;
    }>("/config")
      .then((c) => {
        setLimit(c.max_upload_mb);
        if (c.auth_required && !c.authenticated) setModal("auth");
      })
      .catch(() => setError("Could not reach the server."));
    let session: string | null = null;
    try {
      session = localStorage.getItem("briss-session");
    } catch {
      /* Storage may be disabled. */
    }
    if (session)
      api<Document>(`/documents/${session}`)
        .then((d) => {
          let next: Crops = {};
          try {
            const saved = validateRecipe(
              JSON.parse(localStorage.getItem("briss-recipe") ?? "null"),
              d.fingerprint,
              d.page_count,
            );
            next = Object.fromEntries(
              d.groups.map((g) => [
                g.id,
                (
                  saved.groups.find((p) => p.pages.includes(g.pages[0]))
                    ?.rects ?? []
                ).map((r) => ({ ...r, id: uid() })),
              ]),
            );
          } catch {
            /* Invalid saved plan simply starts without crops. */
          }
          setDoc(d);
          setGroupId(d.groups[0].id);
          setOptions(d.options);
          setHistory({ past: [], present: next, future: [] });
        })
        .catch(() => {
          localStorage.removeItem("briss-session");
        });
  }, []);
  useEffect(() => {
    if (doc) {
      try {
        localStorage.setItem("briss-session", doc.id);
        localStorage.setItem("briss-recipe", JSON.stringify(recipe()));
      } catch {
        /* Editing continues if browser storage is disabled. */
      }
    }
  }, [doc, crops]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (!modal && !preview) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const first =
      dialog.querySelector<HTMLElement>("input") ??
      dialog.querySelector<HTMLElement>("button,select");
    first?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key === "Escape" && modal !== "auth") {
        setModal(null);
        setPreview("");
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          dialog!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal, preview]);
  function remove() {
    commit(
      Object.fromEntries(
        Object.entries(crops).map(([id, rs]) => [
          id,
          rs.filter((r) => !selected.includes(r.id)),
        ]),
      ),
    );
    setSelected([]);
  }
  function copy() {
    clipboard.current = chosen.map((r) => ({ ...r }));
    if (chosen.length)
      setNotice(
        `${chosen.length} region${chosen.length > 1 ? "s" : ""} copied`,
      );
  }
  function paste() {
    if (!group || !clipboard.current.length) return;
    const next = clipboard.current
      .slice(0, 32 - rects.length)
      .map((r) => ({ ...r, id: uid() }));
    commit({ ...crops, [group.id]: [...rects, ...next] });
    setSelected(next.map((r) => r.id));
  }
  function match(axis: "w" | "h") {
    const max = Math.max(...chosen.map((r) => r[axis]));
    commit(
      Object.fromEntries(
        Object.entries(crops).map(([id, rs]) => [
          id,
          rs.map((r) =>
            selected.includes(r.id) ? bounded({ ...r, [axis]: max }) : r,
          ),
        ]),
      ),
    );
  }
  const unitFactor = unit === "mm" ? 72 / 25.4 : unit === "in" ? 72 : 1;
  function matchAll() {
    if (!doc || !all.length) return;
    const widths = doc.groups.flatMap((g) =>
      (crops[g.id] ?? []).map((r) => r.w * g.width),
    );
    const heights = doc.groups.flatMap((g) =>
      (crops[g.id] ?? []).map((r) => r.h * g.height),
    );
    const w = Math.max(...widths),
      h = Math.max(...heights);
    commit(
      Object.fromEntries(
        doc.groups.map((g) => [
          g.id,
          (crops[g.id] ?? []).map((r) =>
            bounded({ ...r, w: w / g.width, h: h / g.height }),
          ),
        ]),
      ),
    );
    setNotice("All regions matched to the largest size that fits each page");
  }
  function change(field: "x" | "y" | "w" | "h", value: number) {
    if (!group || !Number.isFinite(value)) return;
    const ratio =
      (value * unitFactor) /
      (field === "x" || field === "w" ? group.width : group.height);
    commit({
      ...crops,
      [group.id]: rects.map((r) =>
        selected.includes(r.id) ? bounded({ ...r, [field]: ratio }) : r,
      ),
    });
  }
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement)?.matches("input,textarea,select") ||
        modal ||
        preview ||
        busy
      )
        return;
      const cmd = e.ctrlKey || e.metaKey;
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (cmd && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (cmd && e.key.toLowerCase() === "c") {
        e.preventDefault();
        copy();
      } else if (cmd && e.key.toLowerCase() === "v") {
        e.preventDefault();
        paste();
      } else if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(rects.map((r) => r.id));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (chosen.length) remove();
      } else if (e.key === "Escape") setSelected([]);
      else if (e.key.toLowerCase() === "d") setTool("draw");
      else if (e.key.toLowerCase() === "v") setTool("select");
      else if (e.key === "?") setModal("help");
      else if (e.key.startsWith("Arrow") && group && chosen.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        commit({
          ...crops,
          [group.id]: rects.map((r) =>
            selected.includes(r.id)
              ? bounded({
                  ...r,
                  x:
                    r.x +
                    (e.key === "ArrowRight"
                      ? step / group.width
                      : e.key === "ArrowLeft"
                        ? -step / group.width
                        : 0),
                  y:
                    r.y +
                    (e.key === "ArrowDown"
                      ? step / group.height
                      : e.key === "ArrowUp"
                        ? -step / group.height
                        : 0),
                })
              : r,
          ),
        });
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [crops, selected, history, group, modal, preview, busy]);
  async function accept(d: Document) {
    const previous = doc?.id;
    setDoc(d);
    setGroupId(d.groups[0].id);
    setOptions(d.options);
    setHistory(empty);
    setSelected([]);
    setPage(null);
    setZoom(1);
    setModal(null);
    setPassword("");
    if (previous && previous !== d.id)
      api(`/documents/${previous}`, { method: "DELETE" }).catch(() => {});
    try {
      const detected = await api<Record<string, Omit<Rect, "id">>>(
        `/documents/${d.id}/auto`,
        json({ margin, threshold }),
      );
      setHistory({
        past: [],
        present: Object.fromEntries(
          Object.entries(detected).map(([id, r]) => [
            id,
            [{ ...r, id: uid() }],
          ]),
        ),
        future: [],
      });
    } catch {
      setNotice("PDF loaded. Draw a region or try Auto crop.");
    }
  }
  function openFile(file: File, secret = "") {
    if (file.size > limit * 1024 * 1024) {
      setError(`Choose a PDF smaller than ${limit} MB.`);
      return;
    }
    pendingFile.current = file;
    work("Opening your PDF", async () => {
      const data = new FormData();
      data.set("file", file);
      data.set("password", secret);
      try {
        await accept(
          await api<Document>("/documents", { method: "POST", body: data }),
        );
        pendingFile.current = null;
      } catch (e) {
        if (e instanceof Error && e.message.includes("password")) {
          setPassword("");
          setModal("password");
        } else throw e;
      }
    });
  }
  async function autoCrop(allGroups = false) {
    if (!doc || !group) return;
    await work("Finding content edges", async () => {
      if (allGroups) {
        const result = await api<Record<string, Omit<Rect, "id">>>(
          `/documents/${doc.id}/auto`,
          json({ margin, threshold }),
        );
        commit(
          Object.fromEntries(
            Object.entries(result).map(([id, r]) => [
              id,
              [{ ...r, id: uid() }],
            ]),
          ),
        );
      } else {
        const r = await api<Omit<Rect, "id">>(
          `/documents/${doc.id}/groups/${group.id}/auto`,
          json({ margin, threshold }),
        );
        const region = { ...r, id: uid() };
        commit({ ...crops, [group.id]: [region] });
        setSelected([region.id]);
      }
    });
  }
  async function regroup() {
    if (!doc) return;
    await work("Updating page groups", async () => {
      const d = await api<Document>(
        `/documents/${doc.id}/groups`,
        json(options, "PUT"),
      );
      setHistory({
        past: [],
        present: transfer(doc.groups, d.groups, crops),
        future: [],
      });
      setDoc(d);
      setGroupId(d.groups[0].id);
      setPage(null);
      setSelected([]);
      setModal(null);
    });
  }
  async function loadRecipe(file: File) {
    if (!doc) return;
    await work("Loading crop recipe", async () => {
      if (file.size > 2 * 1024 * 1024) throw Error("Recipe is too large.");
      const saved = validateRecipe(
        JSON.parse(await file.text()),
        doc.fingerprint,
        doc.page_count,
      );
      const d = await api<Document>(
        `/documents/${doc.id}/groups`,
        json(saved.options, "PUT"),
      );
      const next = Object.fromEntries(
        d.groups.map((g) => [
          g.id,
          (
            saved.groups.find((p) => p.pages.includes(g.pages[0]))?.rects ?? []
          ).map((r) => ({ ...r, id: uid() })),
        ]),
      );
      setDoc(d);
      setOptions(d.options);
      setGroupId(d.groups[0].id);
      setPage(null);
      setSelected([]);
      setHistory({ past: [], present: next, future: [] });
      setNotice("Crop recipe restored");
    });
  }
  async function exportDocument(isPreview = false) {
    if (!doc) return;
    await work(
      isPreview ? "Preparing your preview" : "Preparing your PDF",
      async () => {
        const response = await fetch(
          `/api/documents/${doc.id}/export`,
          json({ groups: recipe().groups }),
        );
        if (!response.ok) {
          const e = await response.json();
          throw Error(e.detail ?? "Export failed.");
        }
        const blob = await response.blob();
        if (isPreview) setPreview(URL.createObjectURL(blob));
        else {
          download(blob, doc.filename.replace(/\.pdf$/i, "") + "_cropped.pdf");
          setNotice("Your cropped PDF is ready");
        }
      },
    );
  }
  function saveRecipe() {
    if (doc) {
      download(
        new Blob([JSON.stringify(recipe(), null, 2)], {
          type: "application/json",
        }),
        doc.filename.replace(/\.pdf$/i, "") + ".briss.json",
      );
      setNotice("Crop recipe saved");
    }
  }
  function reorder(index: number, delta: number) {
    if (!group) return;
    const next = [...rects];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    commit({ ...crops, [group.id]: next });
  }
  async function close() {
    if (!doc) return;
    await work("Closing document", async () => {
      await api(`/documents/${doc.id}`, { method: "DELETE" });
      setDoc(null);
      setHistory(empty);
      localStorage.removeItem("briss-session");
      localStorage.removeItem("briss-recipe");
    });
  }
  const disabled = !!busy;
  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDrop(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrop(false);
        const f = e.dataTransfer.files[0];
        if (f && !busy) openFile(f);
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".pdf,application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={recipeInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) loadRecipe(f);
          e.target.value = "";
        }}
      />
      <header className="header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-icon">
            <Crop size={24} />
          </span>
          <span>
            briss<span className="brand-light"> studio</span>
          </span>
          <span className="self-hosted">SELF-HOSTED</span>
        </a>
        <div className="header-right">
          <button className="text-button" onClick={() => setModal("help")}>
            <Keyboard size={16} />
            <span>Shortcuts</span>
          </button>
          <span className="header-divider" />
          <span className="connection">
            <i />
            Private workspace
          </span>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {!doc ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">
              <span />A LITTLE LESS. A LOT BETTER.
            </span>
            <h1>
              Make room for
              <br />
              what <em>matters.</em>
            </h1>
            <p>
              Trim the margins. Split the columns.
              <br />
              Give your PDFs a little breathing room.
            </p>
            <div className="welcome-pills">
              <span>
                <Check size={14} />
                Original PDF quality
              </span>
              <span>
                <Check size={14} />
                Runs on your server
              </span>
            </div>
          </div>
          <div className="upload-card">
            <div className="upload-illustration">
              <div className="tiny-paper">
                <div className="tiny-line title" />
                <div className="tiny-columns">
                  {[0, 1].map((n) => (
                    <div key={n}>
                      {Array.from({ length: 9 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </div>
                  ))}
                </div>
                <div className="tiny-crop">
                  <b />
                  <b />
                  <b />
                  <b />
                </div>
              </div>
              <div className="upload-badge">
                <Crop size={22} />
              </div>
            </div>
            <h2>Your next clean page starts here.</h2>
            <p>Drop a PDF anywhere, or choose one below.</p>
            <button
              className="primary large"
              onClick={() => input.current?.click()}
              disabled={disabled}
            >
              <Upload size={18} />
              Choose a PDF
              <ArrowUpRight size={17} />
            </button>
            <div className="upload-limit">PDF files up to {limit} MB</div>
            <div className="sample-row">
              <span>Just looking around?</span>
              <button
                onClick={() =>
                  work("Opening the sample", async () =>
                    accept(await api<Document>("/demo", { method: "POST" })),
                  )
                }
                disabled={disabled}
              >
                Try a sample
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
          <div className="welcome-footer">
            <span>
              <Layers size={18} />
              <b>See the whole picture</b>Overlay similar pages to find a crop
              that fits.
            </span>
            <span>
              <SquareDashed size={18} />
              <b>Keep just what you need</b>Draw multiple regions to split a
              page.
            </span>
            <span>
              <Eye size={18} />
              <b>Check before you export</b>Preview the exact PDF you’ll
              download.
            </span>
          </div>
        </main>
      ) : (
        <>
          <div className="document-bar">
            <div className="document-name">
              <span className="file-icon">
                <FileText size={20} />
              </span>
              <div>
                <strong title={doc.filename}>{doc.filename}</strong>
                <span>
                  {doc.page_count} pages <b>·</b> {doc.groups.length} page
                  groups
                </span>
              </div>
              <IconButton
                title="Open another PDF"
                onClick={() => input.current?.click()}
                disabled={disabled}
              >
                <FolderOpen size={17} />
              </IconButton>
            </div>
            <div className="steps">
              <span className="done">
                <Check size={12} />
                Upload
              </span>
              <i />
              <span className="current">
                <b>2</b>Refine crop
              </span>
              <i />
              <span>
                <b>3</b>Export
              </span>
            </div>
            <div className="export-actions">
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => exportDocument(true)}
              >
                <Eye size={16} />
                Preview
              </button>
              <button
                className="primary"
                disabled={disabled}
                onClick={() => exportDocument()}
              >
                <Download size={16} />
                Export PDF
              </button>
            </div>
          </div>
          <div className={`workspace ${sidebar ? "" : "hide-sidebar"}`}>
            <button
              className="groups-backdrop"
              aria-label="Dismiss page groups"
              onClick={() => setSidebar(false)}
            />
            <aside className="groups-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">YOUR DOCUMENT</span>
                  <h2>
                    Page groups <span>{doc.groups.length}</span>
                  </h2>
                </div>
                <span className="drawer-close">
                  <IconButton
                    title="Close page groups"
                    onClick={() => setSidebar(false)}
                  >
                    <X size={17} />
                  </IconButton>
                </span>
                <IconButton
                  title="Configure page groups"
                  onClick={() => {
                    setOptions(doc.options);
                    setModal("settings");
                  }}
                  disabled={disabled}
                >
                  <Settings2 size={17} />
                </IconButton>
              </div>
              <p className="panel-description">
                Similar pages, layered together.
                <br />
                One crop applies to the whole group.
              </p>
              <div className="group-list">
                {doc.groups.map((g, index) => (
                  <button
                    key={g.id}
                    className={`group-card ${g.id === group?.id ? "active" : ""}`}
                    disabled={disabled}
                    onClick={() => {
                      setGroupId(g.id);
                      setPage(null);
                      setZoom(1);
                      setSelected([]);
                    }}
                  >
                    <span className="group-thumbnail">
                      <FileText size={30} />
                      <span>{(crops[g.id] ?? []).length || "—"}</span>
                    </span>
                    <span className="group-info">
                      <strong>{g.label}</strong>
                      <span>
                        {g.pages.length} page{g.pages.length > 1 ? "s" : ""} ·{" "}
                        {Math.round(g.width)} × {Math.round(g.height)}
                      </span>
                      <small>
                        Pages {g.pages.slice(0, 4).join(", ")}
                        {g.pages.length > 4 ? "…" : ""}
                      </small>
                    </span>
                    <span className="group-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </button>
                ))}
              </div>
              <div className="sidebar-bottom">
                <div className="tip">
                  <ScanLine size={18} />
                  <p>
                    <strong>Start with a smart crop.</strong>Auto crop finds the
                    content edges. You make the finishing touches.
                  </p>
                </div>
                <button
                  className="secondary wide"
                  disabled={disabled}
                  onClick={() => autoCrop(true)}
                >
                  <ScanLine size={16} />
                  Auto crop all groups
                </button>
                <div className="recipe-actions">
                  <button onClick={saveRecipe} disabled={disabled}>
                    <Save size={14} />
                    Save recipe
                  </button>
                  <button
                    onClick={() => recipeInput.current?.click()}
                    disabled={disabled}
                  >
                    <FolderOpen size={14} />
                    Load
                  </button>
                </div>
              </div>
            </aside>
            <section className="editor">
              <div className="editor-toolbar">
                <div className="tool-section">
                  <IconButton
                    title="Toggle page groups"
                    onClick={() => setSidebar(!sidebar)}
                  >
                    <PanelLeftClose size={17} />
                  </IconButton>
                  <span className="toolbar-divider" />
                  <IconButton
                    title="Select and move (V)"
                    active={tool === "select"}
                    disabled={disabled}
                    onClick={() => setTool("select")}
                  >
                    <MousePointer2 size={17} />
                  </IconButton>
                  <IconButton
                    title="Draw a crop region (D)"
                    active={tool === "draw"}
                    disabled={disabled}
                    onClick={() => setTool("draw")}
                  >
                    <SquareDashed size={18} />
                  </IconButton>
                  <span className="toolbar-divider" />
                  <IconButton
                    title="Undo (⌘/Ctrl Z)"
                    disabled={disabled || !history.past.length}
                    onClick={undo}
                  >
                    <Undo2 size={17} />
                  </IconButton>
                  <IconButton
                    title="Redo (⌘/Ctrl Shift Z)"
                    disabled={disabled || !history.future.length}
                    onClick={redo}
                  >
                    <Redo2 size={17} />
                  </IconButton>
                </div>
                <div className="zoom-tools">
                  <IconButton
                    title="Zoom out"
                    disabled={zoom <= 0.5}
                    onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                  >
                    <Minus size={15} />
                  </IconButton>
                  <button
                    className="zoom-value"
                    onClick={() => setZoom(1)}
                    title="Fit to workspace"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <IconButton
                    title="Zoom in"
                    disabled={zoom >= 3}
                    onClick={() => setZoom(Math.min(3, zoom + 0.25))}
                  >
                    <Plus size={15} />
                  </IconButton>
                  <IconButton title="Fit page" onClick={() => setZoom(1)}>
                    <Maximize2 size={15} />
                  </IconButton>
                </div>
              </div>
              <div className="view-bar">
                <span>
                  <i />
                  {group?.label}
                  <b>{page ? "Single page" : "Merged view"}</b>
                </span>
                <label className="view-picker">
                  <Layers size={14} />
                  <select
                    aria-label="Preview page"
                    value={page ?? "overlay"}
                    onChange={(e) =>
                      setPage(
                        e.target.value === "overlay"
                          ? null
                          : Number(e.target.value),
                      )
                    }
                  >
                    <option value="overlay">
                      Overlay · {group?.samples.length} pages
                    </option>
                    {group?.pages.map((n) => (
                      <option key={n} value={n}>
                        Page {n}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              {group && (
                <Canvas
                  key={group.id}
                  group={group}
                  session={doc.id}
                  rects={rects}
                  selected={selected}
                  onSelect={setSelected}
                  onChange={(rs) => commit({ ...crops, [group.id]: rs })}
                  tool={tool}
                  zoom={zoom}
                  page={page}
                />
              )}
              <div className="editor-footer">
                <span>
                  {tool === "draw" ? (
                    <>
                      <SquareDashed size={14} />
                      Drag to draw a crop region
                    </>
                  ) : (
                    <>
                      <MousePointer2 size={14} />
                      Drag to move · Use handles to resize
                    </>
                  )}
                </span>
                <span>
                  {group && group.pages.length > 15
                    ? "Overlay samples 15 pages · "
                    : ""}
                  {rects.length} region{rects.length !== 1 ? "s" : ""}
                </span>
              </div>
            </section>
            <aside className="inspector">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">MAKE IT PRECISE</span>
                  <h2>Crop regions</h2>
                </div>
                <span className="count-badge">{rects.length}</span>
              </div>
              <p className="panel-description">
                Each region becomes a separate page.
                <br />
                Listed in the order they’ll be exported.
              </p>
              <button
                className="auto-button"
                disabled={disabled}
                onClick={() => autoCrop()}
              >
                <ScanLine size={17} />
                <span>Auto crop this group</span>
                <ArrowRight size={15} />
              </button>
              <div className="regions-list">
                {!rects.length && (
                  <div className="empty-regions">
                    <SquareDashed size={25} />
                    <strong>No crop regions yet</strong>
                    <span>This group will keep its original pages.</span>
                  </div>
                )}
                {rects.map((r, i) => (
                  <div
                    className={`region-row ${selected.includes(r.id) ? "active" : ""}`}
                    key={r.id}
                  >
                    <button
                      className="region-select"
                      onClick={(e) =>
                        setSelected(
                          e.ctrlKey || e.metaKey || e.shiftKey
                            ? selected.includes(r.id)
                              ? selected.filter((id) => id !== r.id)
                              : [...selected, r.id]
                            : [r.id],
                        )
                      }
                    >
                      <span className="region-number">{i + 1}</span>
                      <span>
                        <strong>Region {String(i + 1).padStart(2, "0")}</strong>
                        <small>
                          {Math.round(r.w * (group?.width ?? 0))} ×{" "}
                          {Math.round(r.h * (group?.height ?? 0))} pt
                        </small>
                      </span>
                    </button>
                    <div className="region-order">
                      <button
                        aria-label={`Move region ${i + 1} earlier`}
                        disabled={i === 0 || disabled}
                        onClick={() => reorder(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Move region ${i + 1} later`}
                        disabled={i === rects.length - 1 || disabled}
                        onClick={() => reorder(i, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="add-region"
                disabled={rects.length >= 32 || disabled}
                onClick={() => {
                  setTool("draw");
                  setSelected([]);
                  setNotice("Drag on the page to draw a new crop region");
                }}
              >
                <Plus size={16} />
                Draw another region
              </button>
              {active && group && (
                <div className="dimensions">
                  <div className="section-label">
                    {chosen.length > 1
                      ? `${chosen.length} REGIONS SELECTED`
                      : "POSITION & SIZE"}
                    <select
                      aria-label="Dimension units"
                      value={unit}
                      onChange={(e) =>
                        setUnit(e.target.value as "pt" | "mm" | "in")
                      }
                    >
                      <option value="pt">pt</option>
                      <option value="mm">mm</option>
                      <option value="in">in</option>
                    </select>
                  </div>
                  <div className="dimension-grid">
                    {(["x", "y", "w", "h"] as const).map((field) => (
                      <label key={field}>
                        <span>
                          {{ x: "X", y: "Y", w: "Width", h: "Height" }[field]}
                        </span>
                        <input
                          aria-label={`Region ${field}`}
                          key={`${active.id}-${field}-${active[field]}-${unit}`}
                          type="number"
                          min="0"
                          step={unit === "in" ? 0.01 : 0.1}
                          defaultValue={(
                            (active[field] *
                              (field === "x" || field === "w"
                                ? group.width
                                : group.height)) /
                            unitFactor
                          ).toFixed(unit === "in" ? 3 : 1)}
                          disabled={disabled}
                          onBlur={(e) => {
                            if (
                              e.currentTarget.value !==
                              e.currentTarget.defaultValue
                            )
                              change(field, Number(e.target.value));
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="selection-actions">
                    <IconButton
                      title="Copy selected regions"
                      onClick={copy}
                      disabled={disabled}
                    >
                      <Copy size={16} />
                    </IconButton>
                    <IconButton
                      title="Paste regions"
                      onClick={paste}
                      disabled={disabled}
                    >
                      <ClipboardPaste size={16} />
                    </IconButton>
                    <IconButton
                      title="Match widest selected region"
                      onClick={() => match("w")}
                      disabled={chosen.length < 2 || disabled}
                    >
                      <MoveHorizontal size={16} />
                    </IconButton>
                    <IconButton
                      title="Match tallest selected region"
                      onClick={() => match("h")}
                      disabled={chosen.length < 2 || disabled}
                    >
                      <MoveVertical size={16} />
                    </IconButton>
                    <IconButton
                      title="Delete selected regions"
                      onClick={remove}
                      disabled={disabled}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                </div>
              )}
              <div className="inspector-bottom">
                <button
                  className="text-button"
                  disabled={disabled || all.length < 2}
                  onClick={matchAll}
                >
                  <MoveHorizontal size={14} />
                  Match all region sizes
                </button>
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    if (group) {
                      const r = full();
                      commit({ ...crops, [group.id]: [r] });
                      setSelected([r.id]);
                    }
                  }}
                >
                  <Maximize2 size={14} />
                  Reset group to full page
                </button>
                <div className="output-summary">
                  <span className="section-label">READY TO EXPORT</span>
                  <strong>
                    {outputCount}
                    <span> output pages</span>
                  </strong>
                  <p>
                    <Check size={13} />
                    Text stays sharp and selectable
                  </p>
                  <p>
                    <Check size={13} />
                    Metadata & bookmarks preserved
                  </p>
                </div>
                <button
                  className="close-doc"
                  disabled={disabled}
                  onClick={close}
                >
                  <X size={13} />
                  Close and remove document
                </button>
              </div>
            </aside>
          </div>
        </>
      )}
      {drop && (
        <div className="drop-overlay">
          <Upload size={44} />
          <h2>Drop your PDF here</h2>
          <p>Let’s make a little room.</p>
        </div>
      )}
      {busy && (
        <div className="busy-overlay" role="status">
          <div>
            <Loader2 className="spin" size={25} />
            <strong>{busy}…</strong>
            <span>Larger documents may take a moment.</span>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (modal !== "auth") setModal(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "settings"
                ? "Page group settings"
                : modal === "help"
                  ? "Keyboard shortcuts"
                  : modal === "auth"
                    ? "Server sign in"
                    : "PDF password"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={19} />
            </button>
            {modal === "settings" ? (
              <>
                <span className="eyebrow">YOUR WORKSPACE, YOUR WAY</span>
                <h2>Page group settings</h2>
                <p>Group similar layouts, or work on every page separately.</p>
                <label className="form-label">
                  Group pages by
                  <select
                    value={options.mode}
                    onChange={(e) =>
                      setOptions({
                        ...options,
                        mode: e.target.value as Options["mode"],
                      })
                    }
                  >
                    <option value="parity">Size + odd / even pages</option>
                    <option value="size">Page size only</option>
                    <option value="individual">Every page individually</option>
                  </select>
                </label>
                <label className="form-label">
                  Keep these pages in separate groups
                  <input
                    placeholder="e.g. 1, 4-6"
                    value={options.excludes}
                    onChange={(e) =>
                      setOptions({ ...options, excludes: e.target.value })
                    }
                  />
                  <small>
                    Useful for covers, title pages, or unusual layouts. They
                    stay in your output.
                  </small>
                </label>
                <div className="form-two">
                  <label className="form-label">
                    Auto crop padding (pt)
                    <input
                      type="number"
                      min="0"
                      max="72"
                      value={margin}
                      onChange={(e) =>
                        setMargin(
                          Math.min(72, Math.max(0, Number(e.target.value))),
                        )
                      }
                    />
                  </label>
                  <label className="form-label">
                    White threshold
                    <input
                      type="number"
                      min="128"
                      max="254"
                      value={threshold}
                      onChange={(e) =>
                        setThreshold(
                          Math.min(254, Math.max(128, Number(e.target.value))),
                        )
                      }
                    />
                  </label>
                </div>
                <p className="form-note">
                  On regrouping, crops follow the first page of each new group.
                  Save a recipe before changing groups if you need the previous
                  plan.
                </p>
                <button
                  className="primary wide"
                  disabled={disabled}
                  onClick={regroup}
                >
                  Apply settings
                  <ArrowRight size={16} />
                </button>
              </>
            ) : modal === "help" ? (
              <>
                <span className="eyebrow">LESS CLICKING, MORE CREATING</span>
                <h2>A few useful shortcuts</h2>
                <div className="shortcut-list">
                  {[
                    ["Select / move", "V"],
                    ["Draw a region", "D"],
                    ["Select multiple regions", "Shift + click"],
                    ["Select all in group", "⌘ / Ctrl + A"],
                    ["Copy / paste regions", "⌘ / Ctrl + C / V"],
                    ["Undo / redo", "⌘ / Ctrl + Z / Shift Z"],
                    ["Move selected regions", "Arrow keys"],
                    ["Move 10 points", "Shift + arrows"],
                    ["Delete selected regions", "Delete / Backspace"],
                    ["Deselect", "Esc"],
                  ].map(([label, key]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <kbd>{key}</kbd>
                    </div>
                  ))}
                </div>
                <p className="form-note">
                  Crop regions hide margins; they do not permanently redact
                  content. Documents are processed on this server and
                  automatically removed after the configured retention period.
                </p>
              </>
            ) : modal === "password" ? (
              <>
                <LockKeyhole size={28} />
                <h2>This PDF is protected.</h2>
                <p>Enter its password to open an editable copy.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (pendingFile.current)
                      openFile(pendingFile.current, password);
                  }}
                >
                  <label className="form-label">
                    PDF password
                    <input
                      type="password"
                      autoFocus
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                  <button className="primary wide" disabled={disabled}>
                    Open PDF
                    <ArrowRight size={16} />
                  </button>
                </form>
              </>
            ) : (
              <>
                <LockKeyhole size={28} />
                <h2>Your private workspace.</h2>
                <p>Enter the access token configured on this server.</p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    work("Signing in", async () => {
                      const body = new FormData();
                      body.set("token", authToken);
                      await api("/auth", { method: "POST", body });
                      setModal(null);
                      setAuthToken("");
                    });
                  }}
                >
                  <label className="form-label">
                    Access token
                    <input
                      type="password"
                      autoFocus
                      value={authToken}
                      onChange={(e) => setAuthToken(e.target.value)}
                    />
                  </label>
                  <button className="primary wide" disabled={disabled}>
                    Enter workspace
                    <ArrowRight size={16} />
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
      {preview && (
        <div
          className="preview-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Export preview"
        >
          <div className="preview-header">
            <button className="text-button" onClick={() => setPreview("")}>
              <ArrowLeft size={17} />
              Back to editing
            </button>
            <strong>
              Export preview <span>{outputCount} pages</span>
            </strong>
            <button
              className="primary"
              onClick={() => exportDocument()}
              disabled={disabled}
            >
              <Download size={16} />
              Download PDF
            </button>
          </div>
          <Suspense
            fallback={<div className="pdf-loading">Opening preview…</div>}
          >
            <PdfPreview url={preview} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
