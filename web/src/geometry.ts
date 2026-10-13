import type { Rect, Crops, Group, Recipe } from "./types";
export const uid = () => crypto.randomUUID();
export const full = (): Rect => ({ id: uid(), x: 0, y: 0, w: 1, h: 1 });
export const clamp = (n: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, n));
export function bounded(r: Rect): Rect {
  const w = clamp(r.w, 0.001),
    h = clamp(r.h, 0.001);
  return { ...r, w, h, x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h) };
}
export function fromPoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
): Omit<Rect, "id"> {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}
export function transfer(old: Group[], next: Group[], crops: Crops): Crops {
  return Object.fromEntries(
    next.map((g) => [
      g.id,
      (
        crops[old.find((o) => o.pages.includes(g.pages[0]))?.id ?? ""] ?? []
      ).map((r) => ({ ...r, id: uid() })),
    ]),
  );
}
export function validateRecipe(
  value: unknown,
  fingerprint: string,
  count: number,
): Recipe {
  const v = value as Recipe;
  if (!v || v.version !== 1 || v.fingerprint !== fingerprint)
    throw Error("This crop recipe belongs to a different PDF.");
  if (
    !v.options ||
    !["parity", "size", "individual"].includes(v.options.mode) ||
    typeof v.options.excludes !== "string" ||
    !Array.isArray(v.groups)
  )
    throw Error("Invalid crop recipe.");
  const pages = new Set<number>();
  for (const g of v.groups) {
    if (
      !Array.isArray(g.pages) ||
      !g.pages.length ||
      !Array.isArray(g.rects) ||
      g.rects.length > 32
    )
      throw Error("Invalid crop recipe.");
    for (const p of g.pages) {
      if (!Number.isInteger(p) || p < 1 || p > count || pages.has(p))
        throw Error("Invalid page list in recipe.");
      pages.add(p);
    }
    for (const r of g.rects) {
      if (
        !r ||
        ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
        r.x < 0 ||
        r.y < 0 ||
        r.w <= 0 ||
        r.h <= 0 ||
        r.x + r.w > 1.000001 ||
        r.y + r.h > 1.000001
      )
        throw Error("Invalid crop region in recipe.");
    }
  }
  if (pages.size !== count)
    throw Error("The crop recipe must cover every page.");
  return v;
}
