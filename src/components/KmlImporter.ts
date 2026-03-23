/**
 * KmlImporter — parses a KML 2.2 file and extracts polygon data.
 *
 * Handles:
 * - UTF-8 with BOM (some exporters declare UTF-16 but write UTF-8)
 * - Chunked processing to keep UI responsive on large files (800+ polygons)
 * - Douglas-Peucker coordinate simplification for dense polygon rings
 */

export interface ParsedPolygon {
  name: string;
  coordinates: { lat: number; lng: number }[];
}

export interface ImportProgress {
  parsed: number;
  total: number;
  currentName: string;
}

const CHUNK_SIZE = 50;

/**
 * Reads a KML file and returns an array of parsed polygons.
 *
 * @param file              The KML file to parse.
 * @param onProgress        Called after each chunk with current progress.
 * @param simplifyThreshold Apply Douglas-Peucker if a ring exceeds this many points (0 = disabled).
 */
export async function parseKmlFile(
  file: File,
  onProgress: (p: ImportProgress) => void,
  simplifyThreshold = 200,
): Promise<ParsedPolygon[]> {
  let text = await file.text();

  // Strip UTF-8 BOM (0xEF 0xBB 0xBF as U+FEFF after decoding)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(
      `Fichier KML invalide : ${parseError.textContent?.slice(0, 200) ?? "erreur inconnue"}`,
    );
  }

  const placemarks = Array.from(doc.getElementsByTagName("Placemark"));
  const total = placemarks.length;
  const results: ParsedPolygon[] = [];

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = placemarks.slice(i, i + CHUNK_SIZE);

    for (const placemark of chunk) {
      const nameEl = placemark.querySelector("name");
      const name = nameEl?.textContent?.trim() || `Polygone ${results.length + 1}`;

      const outerRing = placemark.querySelector("outerBoundaryIs coordinates");
      if (!outerRing?.textContent) continue;

      const coords = parseCoordinates(outerRing.textContent);
      if (coords.length < 3) continue;

      const simplified =
        simplifyThreshold > 0 && coords.length > simplifyThreshold
          ? douglasPeucker(coords, 0.00005)
          : coords;

      results.push({ name, coordinates: simplified });
      onProgress({ parsed: results.length, total, currentName: name });
    }

    // Yield to the event loop between chunks so the UI stays responsive
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return results;
}

// ─── Coordinate string parser ─────────────────────────────────────────────────

function parseCoordinates(text: string): { lat: number; lng: number }[] {
  const coords: { lat: number; lng: number }[] = [];

  for (const token of text.trim().split(/\s+/)) {
    if (!token) continue;
    const parts = token.split(",");
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]!);
    const lat = parseFloat(parts[1]!);
    if (isNaN(lat) || isNaN(lng)) continue;
    coords.push({ lat, lng });
  }

  // Remove closing duplicate point (KML closes rings by repeating the first coordinate)
  if (coords.length > 1) {
    const first = coords[0]!;
    const last = coords[coords.length - 1]!;
    if (Math.abs(first.lat - last.lat) < 1e-9 && Math.abs(first.lng - last.lng) < 1e-9) {
      coords.pop();
    }
  }

  return coords;
}

// ─── Douglas-Peucker line simplification ──────────────────────────────────────

function perpendicularDistance(
  pt: { lat: number; lng: number },
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) {
    return Math.sqrt((pt.lng - a.lng) ** 2 + (pt.lat - a.lat) ** 2);
  }
  const t = ((pt.lng - a.lng) * dx + (pt.lat - a.lat) * dy) / (dx * dx + dy * dy);
  return Math.sqrt((pt.lng - (a.lng + t * dx)) ** 2 + (pt.lat - (a.lat + t * dy)) ** 2);
}

export function douglasPeucker(
  points: { lat: number; lng: number }[],
  epsilon: number,
): { lat: number; lng: number }[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;
  const last = points.length - 1;

  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i]!, points[0]!, points[last]!);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [points[0]!, points[last]!];
}
