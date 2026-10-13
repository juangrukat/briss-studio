import { describe, it, expect } from "vitest";
import { bounded, fromPoints, transfer, validateRecipe } from "./geometry";
import type { Group, Recipe } from "./types";
const group = (id: string, pages: number[]): Group => ({
  id,
  pages,
  samples: pages,
  width: 400,
  height: 600,
  label: id,
  individual: false,
});
describe("crop geometry and recipes", () => {
  it("bounds a moved rectangle without changing its size", () =>
    expect(bounded({ id: "r", x: 0.9, y: -0.2, w: 0.3, h: 0.5 })).toEqual({
      id: "r",
      x: 0.7,
      y: 0,
      w: 0.3,
      h: 0.5,
    }));
  it("draws in either direction", () =>
    expect(fromPoints({ x: 0.8, y: 0.6 }, { x: 0.1, y: 0.2 })).toEqual({
      x: 0.1,
      y: 0.2,
      w: 0.7000000000000001,
      h: 0.39999999999999997,
    }));
  it("transfers crops by first source page", () => {
    const old = [group("odd", [1, 3]), group("even", [2, 4])];
    const next = [group("one", [1]), group("two", [2]), group("rest", [3, 4])];
    const result = transfer(old, next, {
      odd: [{ id: "a", x: 0.1, y: 0.1, w: 0.8, h: 0.8 }],
      even: [],
    });
    expect(result.one[0].x).toBe(0.1);
    expect(result.rest[0].id).not.toBe("a");
    expect(result.two).toEqual([]);
  });
  const recipe: Recipe = {
    version: 1,
    fingerprint: "abc",
    options: { mode: "parity", excludes: "" },
    groups: [{ pages: [1, 2], rects: [{ x: 0, y: 0, w: 1, h: 1 }] }],
  };
  it("accepts a complete crop recipe", () =>
    expect(validateRecipe(recipe, "abc", 2)).toEqual(recipe));
  it("rejects recipes for another PDF", () =>
    expect(() => validateRecipe(recipe, "def", 2)).toThrow("different PDF"));
  it("rejects malicious/outside rectangle geometry", () =>
    expect(() =>
      validateRecipe(
        {
          ...recipe,
          groups: [{ pages: [1, 2], rects: [{ x: 0, y: 0, w: 100, h: 1 }] }],
        },
        "abc",
        2,
      ),
    ).toThrow("Invalid crop"));
  it("rejects incomplete or duplicated page plans", () => {
    expect(() =>
      validateRecipe(
        { ...recipe, groups: [{ pages: [1], rects: [] }] },
        "abc",
        2,
      ),
    ).toThrow("every page");
    expect(() =>
      validateRecipe(
        { ...recipe, groups: [{ pages: [1, 1], rects: [] }] },
        "abc",
        2,
      ),
    ).toThrow("Invalid page");
  });
});
