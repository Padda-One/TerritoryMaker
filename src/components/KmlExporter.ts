/**
 * KmlExporter — builds a KML Polygon document from the resolved segments,
 * provides download and clipboard helpers, and computes stats.
 */

import type { ResolvedSegment, Waypoint } from "./SegmentRouter.ts";
import type { PolygonExportData } from "./MapController.ts";

export type { PolygonExportData };

export interface KmlStats {
  totalPoints: number;
  routeCount: number;
  straightCount: number;
}

// ─── Coordinate list construction ─────────────────────────────────────────────

/**
 * Flattens all segment paths into an ordered list of (lng, lat, alt) tuples
 * suitable for a KML coordinates element. The polygon is automatically closed.
 */
function buildCoordinates(segments: ResolvedSegment[]): string {
  if (segments.length === 0) return "";

  const coords: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    // Skip the first point of every segment after the first to avoid duplicates
    const start = i === 0 ? 0 : 1;
    for (let j = start; j < seg.path.length; j++) {
      const pt = seg.path[j]!;
      coords.push(`${pt.lng().toFixed(7)},${pt.lat().toFixed(7)},0`);
    }
  }

  // Close the polygon by repeating the first coordinate
  if (coords.length > 0) {
    coords.push(coords[0]!);
  }

  return coords.join("\n            ");
}

/**
 * Formats a raw {lat, lng}[] coordinate array into a KML coordinates string.
 * Used for imported polygons whose geometry is stored as plain coordinates.
 */
function buildCoordinatesRaw(coords: { lat: number; lng: number }[]): string {
  if (coords.length === 0) return "";
  const lines = coords.map((c) => `${c.lng.toFixed(7)},${c.lat.toFixed(7)},0`);
  // Close the ring
  lines.push(lines[0]!);
  return lines.join("\n            ");
}

/**
 * Converts a CSS hex color (#rrggbb) to KML ABGR format (aabbggrr).
 */
function hexToKml(hex: string, alpha = "ff"): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `${alpha}${b}${g}${r}`;
}

// ─── KML builder — multi-polygon ──────────────────────────────────────────────

/**
 * Builds a KML document with one Placemark per polygon.
 */
export function buildKmlMulti(polygons: PolygonExportData[]): string {
  const now = new Date().toISOString();

  const styles = polygons
    .map((p, i) => {
      const lineColor = hexToKml(p.color);
      const fillColor = hexToKml(p.color, "33"); // ~20% opacity
      return `    <Style id="style${i}">
      <LineStyle>
        <color>${lineColor}</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>${fillColor}</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
    </Style>`;
    })
    .join("\n\n");

  const placemarks = polygons
    .map((p, i) => {
      const coordinates = p.rawCoordinates
        ? buildCoordinatesRaw(p.rawCoordinates)
        : buildCoordinates(p.segments);
      return `    <Placemark>
      <name>${p.name}</name>
      <styleUrl>#style${i}</styleUrl>
      <Polygon>
        <extrude>0</extrude>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
            ${coordinates}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    })
    .join("\n\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Territory Maker — ${now.slice(0, 10)}</name>
    <description>Tracé exporté depuis Territory Maker</description>

${styles}

${placemarks}
  </Document>
</kml>`;
}

// ─── KML builder — single polygon (backwards compat) ─────────────────────────

/**
 * Builds the full KML document string for a single polygon.
 */
export function buildKml(
  segments: ResolvedSegment[],
  _waypoints: Waypoint[],
): string {
  return buildKmlMulti([{ name: "Territoire", color: "#00e5a0", segments }]);
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function getStats(segments: ResolvedSegment[]): KmlStats {
  let routeCount = 0;
  let straightCount = 0;
  let totalPoints = 0;

  for (const seg of segments) {
    if (seg.mode === "route") {
      routeCount++;
    } else {
      straightCount++;
    }
    totalPoints += seg.path.length;
  }

  // The closed polygon adds one repeated point
  if (segments.length > 0) totalPoints += 1;

  return { totalPoints, routeCount, straightCount };
}

// ─── Export helpers ───────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Triggers a browser download of the KML content as a .kml file.
 */
export function downloadKml(kml: string): void {
  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `itineraire-${todayISO()}.kml`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Copies the KML string to the system clipboard.
 */
export async function copyKml(kml: string): Promise<void> {
  await navigator.clipboard.writeText(kml);
}
