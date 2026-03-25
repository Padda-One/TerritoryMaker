/**
 * NwsCsvImporter — parses a NWS-exported CSV file.
 *
 * Expected columns (in any order):
 *   TerritoryID, CategoryCode, Category, Number, Suffix, Area, Type,
 *   Link1, Link2, CustomNotes1, CustomNotes2, Boundary
 *
 * The Boundary field contains a sequence of [lng,lat] pairs:
 *   "[lng1,lat1],[lng2,lat2],..."
 */

export interface NWSData {
  TerritoryID: string;
  CategoryCode: string;
  Category: string;
  Number: string;
  Suffix: string;
  Area: string;
  Type: string;
  Link1: string;
  Link2: string;
  CustomNotes1: string;
  CustomNotes2: string;
}

export interface NWSRow {
  /** Display name for the TM layer: Number, or "Number-Suffix" when Suffix is non-empty */
  name: string;
  /** Display name for the TM group (folder): Category */
  groupName: string;
  coordinates: { lat: number; lng: number }[];
  nwsData: NWSData;
}

// ─── CSV tokeniser ────────────────────────────────────────────────────────────

/**
 * Split a single CSV line into fields, respecting double-quoted fields
 * (which may contain commas and escaped quotes "").
 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          // Escaped quote inside quoted field
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ─── Boundary parser ──────────────────────────────────────────────────────────

/**
 * Parse the NWS Boundary field into an array of {lat, lng} objects.
 *
 * Input format: "[lng1,lat1],[lng2,lat2],..."
 * Note: NWS stores coordinates as [longitude, latitude] (GeoJSON convention).
 */
function parseBoundary(raw: string): { lat: number; lng: number }[] {
  if (!raw.trim()) return [];

  const pairRe = /\[([^\]]+)\]/g;
  const coords: { lat: number; lng: number }[] = [];
  let m: RegExpExecArray | null;

  while ((m = pairRe.exec(raw)) !== null) {
    const parts = m[1]!.split(",");
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]!.trim());
    const lat = parseFloat(parts[1]!.trim());
    if (isNaN(lat) || isNaN(lng)) continue;
    coords.push({ lat, lng });
  }

  // Remove duplicate closing point (NWS sometimes repeats first point at end)
  if (coords.length > 1) {
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    if (first.lat === last.lat && first.lng === last.lng) {
      coords.pop();
    }
  }

  return coords;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Build the display name from NWS Number + Suffix: "1" or "1-A". */
export function nwsDisplayName(number: string, suffix: string): string {
  return suffix ? `${number}-${suffix}` : number;
}

const NWS_COLUMNS: (keyof NWSData)[] = [
  "TerritoryID", "CategoryCode", "Category", "Number", "Suffix",
  "Area", "Type", "Link1", "Link2", "CustomNotes1", "CustomNotes2",
];

/**
 * Parse a NWS CSV file content into an array of NWSRow objects.
 * Throws if the file does not look like a valid NWS CSV.
 */
export function parseNwsCsv(content: string): NWSRow[] {
  // Strip UTF-8 BOM
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;

  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("Le fichier CSV est vide ou ne contient pas d'en-tête.");

  const headerLine = lines[0]!;
  const headers = splitCsvLine(headerLine).map(h => h.trim());

  // Validate required columns
  const required = ([...NWS_COLUMNS, "Boundary"] as string[]);
  for (const col of required) {
    if (!headers.includes(col)) {
      throw new Error(`Colonne manquante dans le CSV NWS : "${col}". Ce fichier ne semble pas être un export NWS valide.`);
    }
  }

  const colIndex = (name: string) => headers.indexOf(name);
  const boundaryIdx = colIndex("Boundary");

  const rows: NWSRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const fields = splitCsvLine(line);
    const get = (name: string): string => (fields[colIndex(name)] ?? "").trim();

    const nwsData: NWSData = {
      TerritoryID: get("TerritoryID"),
      CategoryCode: get("CategoryCode"),
      Category: get("Category"),
      Number: get("Number"),
      Suffix: get("Suffix"),
      Area: get("Area"),
      Type: get("Type"),
      Link1: get("Link1"),
      Link2: get("Link2"),
      CustomNotes1: get("CustomNotes1"),
      CustomNotes2: get("CustomNotes2"),
    };

    const boundaryRaw = (fields[boundaryIdx] ?? "").trim();
    const coordinates = parseBoundary(boundaryRaw);

    if (coordinates.length < 3) continue;

    rows.push({
      name: nwsDisplayName(nwsData.Number, nwsData.Suffix),
      groupName: nwsData.Category || "Import NWS",
      coordinates,
      nwsData,
    });
  }

  if (rows.length === 0) {
    throw new Error("Aucun territoire avec des coordonnées valides trouvé dans ce fichier CSV.");
  }

  return rows;
}
