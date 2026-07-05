import { describe, expect, it } from "vitest";
import { computeFormula } from "../formula-fix";

// Minimal worksheet stub: computeFormula only calls getValueFromCoords.
function wsFrom(grid: (string | number)[][]) {
  return {
    getValueFromCoords: (x: number, y: number, _processed?: boolean) =>
      grid[y]?.[x] ?? "",
  };
}

const ws = wsFrom([
  // A        B      C
  ["maçã", 10, "fruta"],
  ["banana", 20, "fruta"],
  ["cenoura", 30, "legume"],
  ["banana", 40, "fruta"],
]);

describe("computeFormula", () => {
  it("computes VLOOKUP over a real range", () => {
    expect(computeFormula(ws, '=VLOOKUP("banana", A1:B4, 2, FALSE)')).toBe("=20");
  });

  it("computes SUMIF with a criteria range", () => {
    expect(computeFormula(ws, '=SUMIF(C1:C4, "fruta", B1:B4)')).toBe("=70");
  });

  it("computes COUNTIF", () => {
    expect(computeFormula(ws, '=COUNTIF(A1:A4, "banana")')).toBe("=2");
  });

  it("resolves nested supported calls (INDEX/MATCH)", () => {
    expect(computeFormula(ws, '=INDEX(B1:B4, MATCH("cenoura", A1:A4, 0))')).toBe("=30");
  });

  it("leaves unsupported functions to the default engine", () => {
    expect(computeFormula(ws, "=SUM(B1:B4)")).toBeUndefined();
  });

  it("leaves mixed expressions to the default engine", () => {
    expect(computeFormula(ws, '=SUMIF(C1:C4, "fruta", B1:B4)+1')).toBeUndefined();
  });

  it("ignores non-formula content", () => {
    expect(computeFormula(ws, "olá")).toBeUndefined();
  });

  it("prefers the raw cell formula over the pre-expanded expression", () => {
    const grid: (string | number)[][] = [
      ["x", 1],
      ["y", 2],
      ['=COUNTIF(A1:A2, "x")', ""],
    ];
    const stub = {
      getValueFromCoords: (x: number, y: number, processed?: boolean) => {
        void processed;
        return grid[y]?.[x] ?? "";
      },
    };
    // jspreadsheet pre-expands ranges in `expression`; coords point at the cell.
    expect(computeFormula(stub, '=COUNTIF(A1,A2, "x")', 0, 2)).toBe("=1");
  });
});
