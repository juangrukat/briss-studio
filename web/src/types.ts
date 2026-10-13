export type Rect = { id: string; x: number; y: number; w: number; h: number };
export type Group = {
  id: string;
  label: string;
  pages: number[];
  samples: number[];
  width: number;
  height: number;
  individual: boolean;
};
export type Options = {
  mode: "parity" | "size" | "individual";
  excludes: string;
};
export type Document = {
  id: string;
  filename: string;
  fingerprint: string;
  page_count: number;
  groups: Group[];
  options: Options;
  metadata: Record<string, string>;
};
export type Crops = Record<string, Rect[]>;
export type Recipe = {
  version: 1;
  fingerprint: string;
  options: Options;
  groups: { pages: number[]; rects: Omit<Rect, "id">[] }[];
};
