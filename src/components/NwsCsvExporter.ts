/**
 * NwsCsvExporter — generates NWS-compatible CSV export files
 * and suppression reports (CSV + Excel) for merge operations.
 */

import type { NWSData } from "./NwsCsvImporter.ts";
import { nwsDisplayName } from "./NwsCsvImporter.ts";
import type { PolygonExportData } from "./MapController.ts";
import * as XLSX from "xlsx";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A territory that must be deleted in NWS (result of a merge where user had NWS access). */
export interface SuppressionAFaire extends NWSData {
  /** TerritoryID of the surviving (merged) territory. */
  MergedInto_TerritoryID: string;
  Instructions_MyMaps: string;
}

/** A pair of territories that need to be cross-checked in NWS (merge without NWS access). */
export interface SuppressionAControler {
  // New territory (surviving in CSV)
  TerritoryID_new: string;
  CategoryCode_new: string;
  Category_new: string;
  Number_new: string;
  Suffix_new: string;
  Area_new: string;
  Type_new: string;
  Link1_new: string;
  Link2_new: string;
  CustomNotes1_new: string;
  CustomNotes2_new: string;
  // Old territory (removed from CSV)
  TerritoryID_old: string;
  CategoryCode_old: string;
  Category_old: string;
  Number_old: string;
  Suffix_old: string;
  Area_old: string;
  Type_old: string;
  Link1_old: string;
  Link2_old: string;
  CustomNotes1_old: string;
  CustomNotes2_old: string;
  Instructions: string;
}

// ─── Boundary serialiser ──────────────────────────────────────────────────────

/**
 * Convert a rawCoordinates array back to NWS Boundary format.
 * NWS uses [lng,lat] (GeoJSON convention).
 */
function buildBoundary(coords: { lat: number; lng: number }[]): string {
  return coords.map(c => `[${c.lng},${c.lat}]`).join(",");
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  // Wrap in quotes if the value contains comma, quote, or newline
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsvRow(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}

// ─── Main CSV export ──────────────────────────────────────────────────────────

const NWS_HEADERS = [
  "TerritoryID", "CategoryCode", "Category", "Number", "Suffix",
  "Area", "Type", "Link1", "Link2", "CustomNotes1", "CustomNotes2", "Boundary",
];

/**
 * Extended export data that may carry NWS metadata alongside coordinates.
 */
export interface NWSPolygonExportData extends PolygonExportData {
  nwsData?: NWSData;
}

/**
 * Build a NWS-compatible CSV string from all polygons that carry NWS metadata.
 * Polygons without nwsData (manually drawn) are silently skipped.
 */
export function buildNwsCsv(polygons: NWSPolygonExportData[]): string {
  const lines: string[] = [buildCsvRow(NWS_HEADERS)];

  for (const poly of polygons) {
    if (!poly.nwsData || !poly.rawCoordinates) continue;
    const d = poly.nwsData;
    const boundary = buildBoundary(poly.rawCoordinates);
    lines.push(buildCsvRow([
      d.TerritoryID,
      d.CategoryCode,
      d.Category,
      d.Number,
      d.Suffix,
      d.Area,
      d.Type,
      d.Link1,
      d.Link2,
      d.CustomNotes1,
      d.CustomNotes2,
      boundary,
    ]));
  }

  return lines.join("\n");
}

// ─── Suppression report — CSV ─────────────────────────────────────────────────

const INSTRUCTIONS_MYMAPS_MODIF = (name: string, mergedInto: string) =>
  `Sur MyMaps, carte du territoire conservé (${mergedInto}) : importer le nouveau KML individuel et supprimer l'ancien calque. Sur MyMaps, supprimer la carte du territoire supprimé (${name}).`;

const INSTRUCTIONS_A_CONTROLER = (nameNew: string, nameOld: string) =>
  `Ouvrir NWS et comparer les dates d'attribution de ${nameNew} et ${nameOld}. ` +
  `Si ${nameNew} est le plus récent : supprimer ${nameOld}. ` +
  `Si ${nameOld} est le plus récent : copier la dernière attribution de ${nameOld} sur ${nameNew}, puis supprimer ${nameOld}.`;

/**
 * Build suppression instructions for a territory that was deleted during a merge.
 * Called by RouteUI when nwsAccessMode === "yes".
 */
export function buildSuppressionAFaire(
  deleted: NWSData,
  mergedIntoID: string,
): SuppressionAFaire {
  const displayName = nwsDisplayName(deleted.Number, deleted.Suffix);
  return {
    ...deleted,
    MergedInto_TerritoryID: mergedIntoID,
    Instructions_MyMaps: INSTRUCTIONS_MYMAPS_MODIF(displayName, mergedIntoID),
  };
}

/**
 * Build a suppression-to-control record for a merge done without NWS access.
 * Called by RouteUI when nwsAccessMode === "no".
 */
export function buildSuppressionAControler(
  nwsNew: NWSData,
  nwsOld: NWSData,
): SuppressionAControler {
  const nameNew = nwsDisplayName(nwsNew.Number, nwsNew.Suffix);
  const nameOld = nwsDisplayName(nwsOld.Number, nwsOld.Suffix);
  return {
    TerritoryID_new: nwsNew.TerritoryID,
    CategoryCode_new: nwsNew.CategoryCode,
    Category_new: nwsNew.Category,
    Number_new: nwsNew.Number,
    Suffix_new: nwsNew.Suffix,
    Area_new: nwsNew.Area,
    Type_new: nwsNew.Type,
    Link1_new: nwsNew.Link1,
    Link2_new: nwsNew.Link2,
    CustomNotes1_new: nwsNew.CustomNotes1,
    CustomNotes2_new: nwsNew.CustomNotes2,
    TerritoryID_old: nwsOld.TerritoryID,
    CategoryCode_old: nwsOld.CategoryCode,
    Category_old: nwsOld.Category,
    Number_old: nwsOld.Number,
    Suffix_old: nwsOld.Suffix,
    Area_old: nwsOld.Area,
    Type_old: nwsOld.Type,
    Link1_old: nwsOld.Link1,
    Link2_old: nwsOld.Link2,
    CustomNotes1_old: nwsOld.CustomNotes1,
    CustomNotes2_old: nwsOld.CustomNotes2,
    Instructions: INSTRUCTIONS_A_CONTROLER(nameNew, nameOld),
  };
}

// ─── Suppression report — CSV strings ────────────────────────────────────────

const A_FAIRE_HEADERS = [
  "TerritoryID", "CategoryCode", "Category", "Number", "Suffix",
  "Area", "Type", "Link1", "Link2", "CustomNotes1", "CustomNotes2",
  "MergedInto_TerritoryID", "Instructions_MyMaps",
];

const A_CONTROLER_HEADERS = [
  "TerritoryID_new", "CategoryCode_new", "Category_new", "Number_new", "Suffix_new",
  "Area_new", "Type_new", "Link1_new", "Link2_new", "CustomNotes1_new", "CustomNotes2_new",
  "TerritoryID_old", "CategoryCode_old", "Category_old", "Number_old", "Suffix_old",
  "Area_old", "Type_old", "Link1_old", "Link2_old", "CustomNotes1_old", "CustomNotes2_old",
  "Instructions",
];

export function buildSuppressionsCsv(
  aFaire: SuppressionAFaire[],
  aControler: SuppressionAControler[],
): string {
  const sections: string[] = [];

  if (aFaire.length > 0) {
    const lines = [buildCsvRow(A_FAIRE_HEADERS)];
    for (const r of aFaire) {
      lines.push(buildCsvRow([
        r.TerritoryID, r.CategoryCode, r.Category, r.Number, r.Suffix,
        r.Area, r.Type, r.Link1, r.Link2, r.CustomNotes1, r.CustomNotes2,
        r.MergedInto_TerritoryID, r.Instructions_MyMaps,
      ]));
    }
    sections.push("# Suppressions à faire\n" + lines.join("\n"));
  }

  if (aControler.length > 0) {
    const lines = [buildCsvRow(A_CONTROLER_HEADERS)];
    for (const r of aControler) {
      lines.push(buildCsvRow([
        r.TerritoryID_new, r.CategoryCode_new, r.Category_new, r.Number_new, r.Suffix_new,
        r.Area_new, r.Type_new, r.Link1_new, r.Link2_new, r.CustomNotes1_new, r.CustomNotes2_new,
        r.TerritoryID_old, r.CategoryCode_old, r.Category_old, r.Number_old, r.Suffix_old,
        r.Area_old, r.Type_old, r.Link1_old, r.Link2_old, r.CustomNotes1_old, r.CustomNotes2_old,
        r.Instructions,
      ]));
    }
    sections.push("# Suppressions à contrôler dans NWS\n" + lines.join("\n"));
  }

  return sections.join("\n\n");
}

// ─── Suppression report — Excel ───────────────────────────────────────────────

export function buildSuppressionsXlsx(
  aFaire: SuppressionAFaire[],
  aControler: SuppressionAControler[],
): Blob {
  const wb = XLSX.utils.book_new();

  if (aFaire.length > 0) {
    const data = aFaire.map(r => ({
      TerritoryID: r.TerritoryID,
      CategoryCode: r.CategoryCode,
      Category: r.Category,
      Number: r.Number,
      Suffix: r.Suffix,
      Area: r.Area,
      Type: r.Type,
      Link1: r.Link1,
      Link2: r.Link2,
      CustomNotes1: r.CustomNotes1,
      CustomNotes2: r.CustomNotes2,
      MergedInto_TerritoryID: r.MergedInto_TerritoryID,
      Instructions_MyMaps: r.Instructions_MyMaps,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Suppressions à faire");
  }

  if (aControler.length > 0) {
    const data = aControler.map(r => ({
      TerritoryID_new: r.TerritoryID_new,
      CategoryCode_new: r.CategoryCode_new,
      Category_new: r.Category_new,
      Number_new: r.Number_new,
      Suffix_new: r.Suffix_new,
      Area_new: r.Area_new,
      Type_new: r.Type_new,
      Link1_new: r.Link1_new,
      Link2_new: r.Link2_new,
      CustomNotes1_new: r.CustomNotes1_new,
      CustomNotes2_new: r.CustomNotes2_new,
      TerritoryID_old: r.TerritoryID_old,
      CategoryCode_old: r.CategoryCode_old,
      Category_old: r.Category_old,
      Number_old: r.Number_old,
      Suffix_old: r.Suffix_old,
      Area_old: r.Area_old,
      Type_old: r.Type_old,
      Link1_old: r.Link1_old,
      Link2_old: r.Link2_old,
      CustomNotes1_old: r.CustomNotes1_old,
      CustomNotes2_old: r.CustomNotes2_old,
      Instructions: r.Instructions,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "À contrôler dans NWS");
  }

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ─── File download helper ─────────────────────────────────────────────────────

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, filename: string, mimeType = "text/csv;charset=utf-8;"): void {
  // Prepend BOM for Excel compatibility with UTF-8 CSV
  const bom = "\uFEFF";
  downloadBlob(new Blob([bom + text], { type: mimeType }), filename);
}
