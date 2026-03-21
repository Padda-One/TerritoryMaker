/**
 * SegmentRouter — resolves a segment between two waypoints either by calling
 * the Google Directions API (mode "route") or returning a straight line
 * (mode "straight"). Both produce a path of google.maps.LatLng objects.
 */

export type SegmentMode = "route" | "straight";

export interface Waypoint {
  lat: number;
  lng: number;
  label: string;
  segmentMode: SegmentMode;
}

export interface ResolvedSegment {
  mode: SegmentMode;
  /** Ordered list of LatLng points that form the segment path. */
  path: google.maps.LatLng[];
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

// Human-readable messages for Google Directions status codes
const STATUS_MESSAGES: Partial<Record<string, string>> = {
  REQUEST_DENIED:
    "Clé API invalide ou l'API Directions n'est pas activée. Vérifie ta clé dans Google Cloud Console.",
  ZERO_RESULTS:
    "Aucun itinéraire trouvé entre ces deux points pour ce mode de transport.",
  NOT_FOUND:
    "Un des points de départ ou d'arrivée n'a pas pu être localisé.",
  MAX_WAYPOINTS_EXCEEDED:
    "Trop de points intermédiaires pour une seule requête.",
  INVALID_REQUEST:
    "Requête invalide — vérifie les coordonnées des points.",
  OVER_DAILY_LIMIT:
    "Quota journalier de l'API Directions dépassé.",
  OVER_QUERY_LIMIT:
    "Trop de requêtes envoyées. Attends un moment avant de continuer.",
  UNKNOWN_ERROR:
    "Erreur inconnue de l'API Directions. Réessaie.",
};

function statusMessage(status: string): string {
  return STATUS_MESSAGES[status] ?? `Erreur Directions API : ${status}`;
}

/**
 * Resolves a segment from `from` to `to`.
 *
 * - "straight": immediately returns the two endpoints.
 * - "route": calls DirectionsService, decodes the overview polyline, returns
 *   all intermediate points.
 *
 * @throws {RoutingError} on API errors
 */
export async function resolveSegment(
  from: Waypoint,
  to: Waypoint,
  travelMode: google.maps.TravelMode,
): Promise<ResolvedSegment> {
  if (to.segmentMode === "straight") {
    return {
      mode: "straight",
      path: [
        new google.maps.LatLng(from.lat, from.lng),
        new google.maps.LatLng(to.lat, to.lng),
      ],
    };
  }

  // "route" — call Directions API
  return new Promise<ResolvedSegment>((resolve, reject) => {
    const service = new google.maps.DirectionsService();

    const request: google.maps.DirectionsRequest = {
      origin: new google.maps.LatLng(from.lat, from.lng),
      destination: new google.maps.LatLng(to.lat, to.lng),
      travelMode,
    };

    service.route(request, (result, status) => {
      if (status !== google.maps.DirectionsStatus.OK || !result) {
        reject(new RoutingError(status, statusMessage(status)));
        return;
      }

      // Extract all steps' polylines from the first route's first leg
      const leg = result.routes[0]?.legs[0];
      if (!leg) {
        reject(new RoutingError("NO_LEG", "Aucun itinéraire retourné."));
        return;
      }

      const points: google.maps.LatLng[] = [];
      for (const step of leg.steps) {
        if (step.path && step.path.length > 0) {
          // Avoid duplicating the junction point between steps
          const start = points.length === 0 ? 0 : 1;
          for (let i = start; i < step.path.length; i++) {
            points.push(step.path[i]!);
          }
        }
      }

      if (points.length === 0) {
        reject(new RoutingError("EMPTY_PATH", "L'itinéraire retourné est vide."));
        return;
      }

      resolve({ mode: "route", path: points });
    });
  });
}
