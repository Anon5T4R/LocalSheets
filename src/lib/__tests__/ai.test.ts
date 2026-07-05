import { describe, expect, it } from "vitest";
import { parseEdits, sheetToContext } from "../ai";
import type { Grid } from "../sheet-io";

describe("parseEdits", () => {
  it("reads a fenced json block", () => {
    const text = 'Vou preencher.\n```json\n[{"cell":"A1","value":10}]\n```';
    expect(parseEdits(text)).toEqual([{ cell: "A1", value: 10 }]);
  });

  it("reads a bare json array without fences", () => {
    expect(parseEdits('ok [{"cell":"b2","style":"color: red"}] fim')).toEqual([
      { cell: "B2", style: "color: red" },
    ]);
  });

  it("drops entries without cell or without value/style", () => {
    const text = '```json\n[{"cell":"A1"},{"value":1},{"cell":"C3","value":"=A1+1"}]\n```';
    expect(parseEdits(text)).toEqual([{ cell: "C3", value: "=A1+1" }]);
  });

  it("returns [] for plain prose answers", () => {
    expect(parseEdits("A soma da coluna A é 42.")).toEqual([]);
  });

  it("returns [] for malformed json", () => {
    expect(parseEdits("```json\n[{cell: A1]\n```")).toEqual([]);
  });
});

describe("sheetToContext", () => {
  it("reports an empty sheet", () => {
    expect(sheetToContext([[""]])).toBe("(planilha vazia)");
  });

  it("renders the used range with A1 headers", () => {
    const ctx = sheetToContext([
      ["nome", "valor"],
      ["a", 10],
    ]);
    expect(ctx).toContain("A |");
    expect(ctx).toContain("nome");
    expect(ctx).not.toContain("ATENÇÃO");
  });

  it("warns the model when the view is cropped", () => {
    const grid: Grid = Array.from({ length: 60 }, (_, r) => [`v${r + 1}`]);
    const ctx = sheetToContext(grid, 40, 20);
    expect(ctx).toContain("ATENÇÃO: recorte parcial");
    expect(ctx).toContain("A60");
  });
});
