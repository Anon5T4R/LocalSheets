import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  Grid,
  gridToSheet,
  sheetToCsv,
  sheetToGrid,
  sheetsToWorkbook,
  usedBounds,
  workbookToSheets,
} from "../sheet-codec";

function roundTrip(sheets: Parameters<typeof sheetsToWorkbook>[0]) {
  const b64 = XLSX.write(sheetsToWorkbook(sheets), { type: "base64", bookType: "xlsx" });
  return workbookToSheets(XLSX.read(b64, { type: "base64" }));
}

describe("usedBounds", () => {
  it("ignores trailing empty rows/cols", () => {
    const grid: Grid = [
      ["a", "", ""],
      ["", 2, ""],
      ["", "", ""],
    ];
    expect(usedBounds(grid)).toEqual({ rows: 2, cols: 2 });
  });

  it("handles an empty grid", () => {
    expect(usedBounds([[""], [""]])).toEqual({ rows: 0, cols: 0 });
  });
});

describe("formula round-trip", () => {
  it("persists formulas as cell.f and restores them as =… strings", () => {
    const raw: Grid = [
      [1, 2, "=SUM(A1:B1)"],
      ["texto", "", ""],
    ];
    const computed: Grid = [
      ["1", "2", "3"],
      ["texto", "", ""],
    ];
    const [sheet] = roundTrip([{ name: "S1", raw, computed }]);
    expect(sheet.data[0][2]).toBe("=SUM(A1:B1)");
    expect(sheet.data[0][0]).toBe(1);
    expect(sheet.data[1][0]).toBe("texto");
  });

  it("caches the computed value so Excel-compatible readers keep the cell", () => {
    const ws = gridToSheet([["=1+1"]], [["2"]]);
    expect(ws["A1"]).toMatchObject({ t: "n", v: 2, f: "1+1" });
  });

  it("caches text results of formulas as strings", () => {
    const ws = gridToSheet([['=IF(1,"sim","não")']], [["sim"]]);
    expect(ws["A1"]).toMatchObject({ t: "s", v: "sim", f: 'IF(1,"sim","não")' });
  });
});

describe("multi-sheet round-trip", () => {
  it("keeps every worksheet with its name and data", () => {
    const sheets = roundTrip([
      { name: "Vendas", raw: [["a"]], computed: [["a"]] },
      { name: "Custos", raw: [[42]], computed: [["42"]] },
    ]);
    expect(sheets.map((s) => s.name)).toEqual(["Vendas", "Custos"]);
    expect(sheets[1].data[0][0]).toBe(42);
  });

  it("sanitizes and deduplicates worksheet names", () => {
    const wb = sheetsToWorkbook([
      { name: "a/b:c", raw: [["x"]], computed: [["x"]] },
      { name: "a b c", raw: [["y"]], computed: [["y"]] },
      { name: "", raw: [["z"]], computed: [["z"]] },
    ]);
    expect(wb.SheetNames).toEqual(["a b c", "a b c (2)", "Planilha3"]);
  });
});

describe("sheetToCsv", () => {
  it("exports displayed values (formula results), not formulas", () => {
    const csv = sheetToCsv({
      name: "S",
      raw: [
        ["a", "b"],
        ["=SUM(A1)", 2],
      ],
      computed: [
        ["a", "b"],
        ["10", "2"],
      ],
    });
    expect(csv.trim().split("\n").map((l) => l.trim())).toEqual(["a,b", "10,2"]);
  });
});

describe("sheetToGrid", () => {
  it("returns a 1x1 empty grid for an empty worksheet", () => {
    expect(sheetToGrid({})).toEqual([[""]]);
  });

  it("renders booleans as TRUE/FALSE text", () => {
    const ws: XLSX.WorkSheet = { "!ref": "A1", A1: { t: "b", v: true } };
    expect(sheetToGrid(ws)).toEqual([["TRUE"]]);
  });
});
