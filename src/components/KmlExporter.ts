/**
 * KmlExporter — builds a KML Polygon document from the resolved segments,
 * provides download and clipboard helpers, and computes stats.
 */

import type { ResolvedSegment, Waypoint } from "./SegmentRouter.ts";

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

// ─── KML builder ─────────────────────────────────────────────────────────────

/**
 * Builds the full KML document string.
 */
export function buildKml(
  segments: ResolvedSegment[],
  _waypoints: Waypoint[],
): string {
  const now = new Date().toISOString();
  const coordinates = buildCoordinates(segments);

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Territory Maker — ${now.slice(0, 10)}</name>
    <description>Tracé exporté depuis Territory Maker</description>

    <Style id="territoryStyle">
      <LineStyle>
        <color>ff00e5a0</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>3300e5a0</color>
        <fill>1</fill>
        <outline>1</outline>
      </PolyStyle>
    </Style>

    <Placemark>
      <name>Territoire</name>
      <styleUrl>#territoryStyle</styleUrl>
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
    </Placemark>
  </Document>
</kml>`;
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
