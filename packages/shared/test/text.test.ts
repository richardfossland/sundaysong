import { describe, expect, test } from "bun:test";
import { foldNordic, tokenize } from "../src/text";

describe("foldNordic", () => {
  test("strips combining diacritics (NFD path)", () => {
    expect(foldNordic("Café")).toBe("cafe");
    expect(foldNordic("Über")).toBe("uber");
    expect(foldNordic("Härlig")).toBe("harlig"); // ä via NFD
    expect(foldNordic("Frälsare")).toBe("fralsare");
  });

  test("transliterates the special Nordic letters", () => {
    expect(foldNordic("Når mitt øye")).toBe("nar mitt oye"); // å→a, ø→o
    expect(foldNordic("Kjærlighet")).toBe("kjaerlighet"); // æ→ae
    expect(foldNordic("Straße")).toBe("strasse"); // ß→ss
  });

  test("is case-insensitive", () => {
    expect(foldNordic("ØYE")).toBe("oye");
    expect(foldNordic("ÅÆØ")).toBe("aaeo");
  });
});

describe("tokenize", () => {
  test("splits a folded string into letter/digit tokens", () => {
    expect(tokenize("Når mitt øye!")).toEqual(["nar", "mitt", "oye"]);
    expect(tokenize("  Salme 21  ")).toEqual(["salme", "21"]);
  });

  test("keyboard/accent variants tokenize identically", () => {
    expect(tokenize("Frälsare")).toEqual(tokenize("Fralsare"));
    expect(tokenize("Kjærlighet")).toEqual(tokenize("Kjaerlighet"));
  });

  test("drops empty tokens", () => {
    expect(tokenize("---")).toEqual([]);
    expect(tokenize("")).toEqual([]);
  });
});
