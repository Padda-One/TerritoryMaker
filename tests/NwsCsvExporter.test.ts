import { describe, it, expect, vi } from "vitest";
import {
  buildNwsCsv,
  buildSuppressionAFaire,
  buildSuppressionAControler,
  buildSuppressionsCsv,
  buildSuppressionsXlsx,
  downloadText,
  type NWSPolygonExportData,
} from "../src/components/NwsCsvExporter.ts";
import { parseNwsCsv, type NWSData } from "../src/components/NwsCsvImporter.ts";

// Données inventées — aucun lien avec un export NWS réel.
function nws(over: Partial<NWSData> = {}): NWSData {
  return {
    TerritoryID: "1001",
    CategoryCode: "V",
    Category: "Ville",
    Number: "12",
    Suffix: "",
    Area: "Quartier Nord",
    Type: "Normal",
    Link1: "",
    Link2: "",
    CustomNotes1: "",
    CustomNotes2: "",
    ...over,
  };
}

const SQUARE = [
  { lat: 48.1, lng: 2.1 },
  { lat: 48.1, lng: 2.2 },
  { lat: 48.2, lng: 2.2 },
];

function poly(over: Partial<NWSPolygonExportData> = {}): NWSPolygonExportData {
  return {
    name: "T",
    color: "#00e5a0",
    segments: [],
    rawCoordinates: SQUARE,
    nwsData: nws(),
    ...over,
  };
}

const HEADER =
  "TerritoryID,CategoryCode,Category,Number,Suffix,Area,Type,Link1,Link2,CustomNotes1,CustomNotes2,Boundary";

/** Extrait le champ d'une ligne de données (2e ligne) via le lecteur CSV de l'application. */
function lastCell(csv: string): string {
  return csv.split("\n").slice(1).join("\n");
}

describe("buildNwsCsv — en-têtes et lignes", () => {
  it("sans polygone : seule la ligne d'en-tête NWS", () => {
    expect(buildNwsCsv([])).toBe(HEADER);
  });

  it("ignore les polygones sans métadonnées NWS ou sans coordonnées brutes", () => {
    const csv = buildNwsCsv([
      poly({ nwsData: undefined }),
      poly({ rawCoordinates: undefined }),
    ]);
    expect(csv).toBe(HEADER);
  });

  it("sérialise la frontière en [lng,lat] dans l'ordre, sans fermer l'anneau", () => {
    const csv = buildNwsCsv([poly()]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '1001,V,Ville,12,,Quartier Nord,Normal,,,,,"[2.1,48.1],[2.2,48.1],[2.2,48.2]"',
    );
  });

  it("une ligne par polygone exportable, ordre d'entrée conservé", () => {
    const csv = buildNwsCsv([
      poly({ nwsData: nws({ TerritoryID: "A" }) }),
      poly({ nwsData: undefined }),
      poly({ nwsData: nws({ TerritoryID: "B" }) }),
    ]);
    const ids = csv.split("\n").slice(1).map(l => l.split(",")[0]);
    expect(ids).toEqual(["A", "B"]);
  });

  it("frontière vide : champ vide en dernière colonne (12 colonnes)", () => {
    const csv = buildNwsCsv([poly({ rawCoordinates: [] })]);
    const row = csv.split("\n")[1]!;
    expect(row.split(",")).toHaveLength(12);
    expect(row.endsWith(",")).toBe(true);
  });
});

describe("buildNwsCsv — échappement", () => {
  const cell = (value: string) =>
    buildNwsCsv([poly({ rawCoordinates: [], nwsData: nws({ CustomNotes1: value }) })]);

  it("laisse tel quel un champ sans caractère spécial, accents compris", () => {
    expect(lastCell(cell("Rue de l'Église — côté pair"))).toContain(
      ",Rue de l'Église — côté pair,",
    );
  });

  it("cite un champ contenant une virgule", () => {
    expect(lastCell(cell("a,b"))).toContain(',"a,b",');
  });

  it("double les guillemets et cite le champ", () => {
    expect(lastCell(cell('dit "le bas"'))).toContain(',"dit ""le bas""",');
  });

  it("cite un champ contenant un retour ligne LF", () => {
    expect(lastCell(cell("ligne1\nligne2"))).toContain(',"ligne1\nligne2",');
  });

  it("cite un champ contenant CRLF", () => {
    expect(lastCell(cell("ligne1\r\nligne2"))).toContain(',"ligne1\r\nligne2",');
  });

  // BOGUE : csvEscape ne teste que "\n" ; un CR isolé sort non cité, ce que
  // RFC 4180 interdit et que la plupart des lecteurs prennent pour une fin de ligne.
  it.fails("cite un champ contenant un CR isolé (RFC 4180)", () => {
    expect(lastCell(cell("ligne1\rligne2"))).toContain(',"ligne1\rligne2",');
  });

  it("aller-retour avec le lecteur NWS de l'application : virgules, guillemets, accents", () => {
    const data = nws({
      Category: "Zone, sud",
      Area: 'Le "Clos" Saint-Éloi',
      CustomNotes1: "œ, ß, 日本",
      Suffix: "A",
    });
    const rows = parseNwsCsv(buildNwsCsv([poly({ nwsData: data })]));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nwsData).toEqual(data);
    expect(rows[0]!.coordinates).toEqual(SQUARE);
    expect(rows[0]!.name).toBe("12-A");
  });

  // BOGUE (paire export/import) : l'export cite correctement un retour ligne, mais
  // parseNwsCsv découpe le fichier par lignes avant de lire les guillemets ; une
  // note multiligne exportée ne se réimporte pas.
  it.fails("aller-retour avec un retour ligne dans CustomNotes1", () => {
    const data = nws({ CustomNotes1: "porte 1\nporte 2" });
    const rows = parseNwsCsv(buildNwsCsv([poly({ nwsData: data })]));
    expect(rows[0]!.nwsData.CustomNotes1).toBe("porte 1\nporte 2");
  });
});

describe("rapports de suppression", () => {
  it("buildSuppressionAFaire : conserve les champs NWS et nomme Number-Suffix", () => {
    const deleted = nws({ TerritoryID: "2002", Number: "7", Suffix: "B" });
    const r = buildSuppressionAFaire(deleted, "1001");
    expect(r).toMatchObject(deleted);
    expect(r.MergedInto_TerritoryID).toBe("1001");
    expect(r.Instructions_MyMaps).toContain("(1001)");
    expect(r.Instructions_MyMaps).toContain("(7-B)");
  });

  it("buildSuppressionAControler : répartit new/old et cite les deux noms", () => {
    const r = buildSuppressionAControler(
      nws({ TerritoryID: "N", Number: "3", Area: "nouveau" }),
      nws({ TerritoryID: "O", Number: "4", Suffix: "C", Area: "ancien" }),
    );
    expect(r.TerritoryID_new).toBe("N");
    expect(r.TerritoryID_old).toBe("O");
    expect(r.Area_new).toBe("nouveau");
    expect(r.Area_old).toBe("ancien");
    expect(r.Instructions).toContain("Si 3 est le plus récent : supprimer 4-C.");
  });

  it("buildSuppressionsCsv : chaîne vide quand rien à signaler", () => {
    expect(buildSuppressionsCsv([], [])).toBe("");
  });

  it("buildSuppressionsCsv : deux sections titrées séparées par une ligne vide", () => {
    const aFaire = [buildSuppressionAFaire(nws({ TerritoryID: "X" }), "Y")];
    const aCtrl = [buildSuppressionAControler(nws({ TerritoryID: "N" }), nws({ TerritoryID: "O" }))];
    const csv = buildSuppressionsCsv(aFaire, aCtrl);
    const [s1, s2, ...rest] = csv.split("\n\n");
    expect(rest).toHaveLength(0);
    expect(s1!.split("\n")[0]).toBe("# Suppressions à faire");
    expect(s1!.split("\n")[1]).toMatch(/^TerritoryID,.*,MergedInto_TerritoryID,Instructions_MyMaps$/);
    expect(s1!.split("\n")[2]!.startsWith("X,")).toBe(true);
    expect(s2!.split("\n")[0]).toBe("# Suppressions à contrôler dans NWS");
    expect(s2!.split("\n")[1]!.split(",")).toHaveLength(23);
  });

  it("buildSuppressionsCsv : les instructions (avec virgules/apostrophes) sont citées", () => {
    const aFaire = [buildSuppressionAFaire(nws(), "Y")];
    const line = buildSuppressionsCsv(aFaire, []).split("\n")[2]!;
    expect(line).toContain(',Y,"Sur MyMaps, carte du territoire conservé (Y)');
    expect(line.endsWith('(12)."')).toBe(true);
  });

  it("buildSuppressionsCsv : seule la section non vide est produite", () => {
    const aCtrl = [buildSuppressionAControler(nws(), nws())];
    const csv = buildSuppressionsCsv([], aCtrl);
    expect(csv.startsWith("# Suppressions à contrôler dans NWS\n")).toBe(true);
    expect(csv).not.toContain("# Suppressions à faire");
  });
});

describe("buildSuppressionsXlsx", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("rien à signaler : Blob vide au type xlsx", async () => {
    const blob = await buildSuppressionsXlsx([], []);
    expect(blob.size).toBe(0);
    expect(blob.type).toBe(XLSX_MIME);
  });

  it("avec données : produit une archive ZIP (signature PK)", async () => {
    const blob = await buildSuppressionsXlsx([buildSuppressionAFaire(nws(), "Y")], []);
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
    expect(Array.from(head)).toEqual([0x50, 0x4b]);
  });
});

describe("downloadText — encodage", () => {
  it("préfixe un BOM UTF-8 et encode les accents en UTF-8", async () => {
    let captured: Blob | undefined;
    const anchor = { href: "", download: "", click: vi.fn() };
    vi.stubGlobal("document", { createElement: () => anchor });
    vi.spyOn(URL, "createObjectURL").mockImplementation(b => {
      captured = b as Blob;
      return "blob:test";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    downloadText("é", "export.csv");

    expect(anchor.download).toBe("export.csv");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(captured!.type).toBe("text/csv;charset=utf-8;");
    const bytes = Array.from(new Uint8Array(await captured!.arrayBuffer()));
    expect(bytes).toEqual([0xef, 0xbb, 0xbf, 0xc3, 0xa9]);
  });
});
