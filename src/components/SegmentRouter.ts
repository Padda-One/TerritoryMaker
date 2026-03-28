/**
 * SegmentRouter — resolves a segment between two waypoints either by calling
 * the OpenRouteService API (mode "route") or returning a straight line
 * (mode "straight"). Both produce a path of plain {lat, lng} objects.
 */

export type SegmentMode = "route" | "straight";

export type TravelMode = "DRIVING" | "WALKING" | "BICYCLING";

export type RoutingProvider = "ors" | "google";

export interface Waypoint {
  lat: number;
  lng: number;
  label: string;
  segmentMode: SegmentMode;
}

export interface ResolvedSegment {
  mode: SegmentMode;
  /** Ordered list of {lat, lng} points that form the segment path. */
  path: { lat: number; lng: number }[];
}

export class RoutingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RoutingError";
  }
}

// ORS profile mapping
const ORS_PROFILES: Record<TravelMode, string> = {
  DRIVING: "driving-car",
  WALKING: "foot-walking",
  BICYCLING: "cycling-regular",
};

// Human-readable messages for ORS / routing errors
const ORS_ERROR_MESSAGES: Record<number, string> = {
  2010: "Aucun itinéraire trouvé entre ces deux points pour ce mode de transport.",
  2002: "Requête invalide — vérifie les coordonnées des points.",
  2004: "Ce mode de transport n'est pas disponible pour cet itinéraire.",
  2099: "L'itinéraire est trop long pour être calculé.",
};

function orsErrorMessage(code: number, fallback: string): string {
  return ORS_ERROR_MESSAGES[code] ?? `Erreur de calcul d'itinéraire (code ${code}) : ${fallback}`;
}

const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions";

/**
 * Resolves a segment from `from` to `to`.
 *
 * - "straight": immediately returns the two endpoints as plain objects.
 * - "route": calls OpenRouteService Directions API, returns the decoded path.
 *
 * @throws {RoutingError} on API errors or network failures
 */
export async function resolveSegment(
  from: Waypoint,
  to: Waypoint,
  travelMode: TravelMode,
  orsApiKey: string,
): Promise<ResolvedSegment> {
  if (to.segmentMode === "straight") {
    return {
      mode: "straight",
      path: [
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      ],
    };
  }

  const profile = ORS_PROFILES[travelMode];
  const url = `${ORS_BASE_URL}/${profile}/geojson`;

  if (!orsApiKey) {
    throw new RoutingError(
      "AUTH_ERROR",
      "Clé API OpenRouteService manquante. Configure ta clé dans les paramètres du serveur.",
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": orsApiKey,
        "Content-Type": "application/json",
        "Accept": "application/json, application/geo+json",
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    });
  } catch {
    throw new RoutingError(
      "NETWORK_ERROR",
      "Impossible de contacter le service de calcul d'itinéraires. Vérifie ta connexion internet.",
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RoutingError("PARSE_ERROR", "Réponse invalide du service de calcul d'itinéraires.");
  }

  if (!response.ok) {
    const err = (data as { error?: { code?: number; message?: string } }).error;
    const code = err?.code ?? response.status;
    const message = err?.message ?? response.statusText;
    if (response.status === 401 || response.status === 403) {
      throw new RoutingError(
        "AUTH_ERROR",
        "Clé API OpenRouteService invalide ou manquante. Configure ta clé dans les paramètres.",
      );
    }
    throw new RoutingError(`ORS_${code}`, orsErrorMessage(code, message));
  }

  // Parse GeoJSON FeatureCollection
  type OrsResponse = {
    features?: Array<{
      geometry?: { coordinates?: [number, number][] };
    }>;
  };
  const feature = (data as OrsResponse).features?.[0];
  const coordinates = feature?.geometry?.coordinates;

  if (!coordinates || coordinates.length === 0) {
    throw new RoutingError("EMPTY_PATH", "L'itinéraire retourné est vide.");
  }

  const path = coordinates.map(([lng, lat]) => ({ lat, lng }));

  return { mode: "route", path };
}

/**
 * Resolves a segment using Google Maps DirectionsService.
 */
export async function resolveSegmentGoogle(
  from: Waypoint,
  to: Waypoint,
  travelMode: TravelMode,
  directionsService: google.maps.DirectionsService,
): Promise<ResolvedSegment> {
  if (to.segmentMode === "straight") {
    return {
      mode: "straight",
      path: [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }],
    };
  }
  const modeMap: Record<TravelMode, google.maps.TravelMode> = {
    DRIVING: google.maps.TravelMode.DRIVING,
    WALKING: google.maps.TravelMode.WALKING,
    BICYCLING: google.maps.TravelMode.BICYCLING,
  };
  return new Promise<ResolvedSegment>((resolve, reject) => {
    directionsService.route(
      {
        origin: { lat: from.lat, lng: from.lng },
        destination: { lat: to.lat, lng: to.lng },
        travelMode: modeMap[travelMode],
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          const path = result.routes[0].overview_path.map((p) => ({
            lat: p.lat(),
            lng: p.lng(),
          }));
          resolve({ mode: "route", path });
        } else if (status === google.maps.DirectionsStatus.ZERO_RESULTS) {
          reject(new RoutingError("ZERO_RESULTS", "Aucun itinéraire trouvé entre ces deux points pour ce mode de transport."));
        } else {
          reject(new RoutingError(status as string, `Erreur de calcul d'itinéraire (${status}).`));
        }
      },
    );
  });
}
