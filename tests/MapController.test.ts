import { describe, it, expect, vi } from "vitest";

// Leaflet lit `window` dès l'import ; le module n'est utilisé qu'à l'exécution
// de MapController (hors banc). On le remplace par un module vide pour pouvoir
// importer les fonctions pures exportées à côté.
vi.mock("leaflet", () => ({}));

const { colorLuminance } = await import("../src/components/MapController.ts");

describe("colorLuminance (luminance relative sRGB / WCAG)", () => {
  it("noir = 0, blanc = 1", () => {
    expect(colorLuminance("#000000")).toBe(0);
    expect(colorLuminance("#ffffff")).toBeCloseTo(1, 10);
  });

  it("primaires pondérées 0.2126 / 0.7152 / 0.0722", () => {
    expect(colorLuminance("#ff0000")).toBeCloseTo(0.2126, 10);
    expect(colorLuminance("#00ff00")).toBeCloseTo(0.7152, 10);
    expect(colorLuminance("#0000ff")).toBeCloseTo(0.0722, 10);
  });

  it("gris moyen #808080 ≈ 0.2159 (valeur de référence WCAG)", () => {
    expect(colorLuminance("#808080")).toBeCloseTo(0.2158605, 6);
  });

  it("segment linéaire sous le seuil 0.04045 : #0a0a0a = (10/255)/12.92", () => {
    expect(colorLuminance("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 12);
  });

  it("insensible à la casse et au # facultatif", () => {
    expect(colorLuminance("ABCDEF")).toBeCloseTo(colorLuminance("#abcdef"), 12);
  });

  it("ordonne les couleurs de la palette : texte sombre sur fonds clairs", () => {
    // Paires (fond, texte) de la palette de MapController : le texte sombre
    // #0f1117 est choisi pour les fonds les plus lumineux.
    const darkText = ["#00e5a0", "#f5a623", "#f1c40f"];
    const lightText = ["#4a90d9", "#e74c3c", "#9b59b6"];
    const minDark = Math.min(...darkText.map(colorLuminance));
    const maxLight = Math.max(...lightText.map(colorLuminance));
    expect(minDark).toBeGreaterThan(maxLight);
  });
});
