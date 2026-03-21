/**
 * MapController — manages the Google Maps instance, markers, polylines, and
 * the canonical waypoints array. Handles dynamic Maps JS API loading.
 */

import { resolveSegment, RoutingError } from "./SegmentRouter.ts";
import type { SegmentMode, Waypoint, ResolvedSegment } from "./SegmentRouter.ts";

export type { SegmentMode, Waypoint, ResolvedSegment };

// ─── Internal extended waypoint ──────────────────────────────────────────────

interface WaypointInternal extends Waypoint {
  marker: google.maps.Marker;
  segment: ResolvedSegment | null; // null for the first point (no incoming seg)
  polyline: google.maps.Polyline | null;
}

// ─── Dark map style ───────────────────────────────────────────────────────────

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1a1d2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8892a4" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0f1117" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#151c24" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#3C7680" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#252840" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#1a1d2e" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3a3d54" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#252840" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#f3d19c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3148" }] },
  { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#d59563" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1520" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#515c6d" }] },
  { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#17263c" }] },
];

// ─── Polyline styles ──────────────────────────────────────────────────────────

const ROUTE_POLYLINE_OPTIONS: google.maps.PolylineOptions = {
  strokeColor: "#00e5a0",
  strokeWeight: 3,
  strokeOpacity: 1.0,
  zIndex: 2,
};

function straightPolylineOptions(): google.maps.PolylineOptions {
  return {
    strokeColor: "#818cf8",
    strokeWeight: 2,
    strokeOpacity: 0,
    zIndex: 1,
    icons: [
      {
        icon: {
          path: "M 0,-1 0,1",
          strokeOpacity: 1,
          strokeColor: "#818cf8",
          strokeWeight: 2,
          scale: 3,
        },
        offset: "0",
        repeat: "10px",
      },
    ],
  };
}

// ─── Marker SVG ───────────────────────────────────────────────────────────────

function createMarkerIcon(label: string, isFirst: boolean): google.maps.Icon {
  const bg = isFirst ? "#00e5a0" : "#818cf8";
  const textColor = isFirst ? "#0f1117" : "#ffffff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.59 14.374 23.05 15.015 23.596a1.5 1.5 0 0 0 1.97 0C17.626 39.05 32 26.59 32 16 32 7.163 24.837 0 16 0z" fill="${bg}"/>
    <text x="16" y="20" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="700" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(32, 40),
    anchor: new google.maps.Point(16, 40),
  };
}

// ─── MapController ────────────────────────────────────────────────────────────

export class MapController {
  private map: google.maps.Map | null = null;
  private internalWaypoints: WaypointInternal[] = [];
  private travelMode: google.maps.TravelMode = google.maps.TravelMode.DRIVING;
  private clickListener: google.maps.MapsEventListener | null = null;

  // Callbacks wired up by RouteUI
  public onWaypointsChanged: ((waypoints: Waypoint[], segments: ResolvedSegment[]) => void) | null = null;
  public onError: ((message: string) => void) | null = null;
  public onLoadingChange: ((loading: boolean) => void) | null = null;

  // ─── Map initialisation ─────────────────────────────────────────────────────

  async init(apiKey: string, mapEl: HTMLElement): Promise<void> {
    await loadGoogleMapsScript(apiKey);
    this.createMap(mapEl);
  }

  private createMap(mapEl: HTMLElement): void {
    this.map = new google.maps.Map(mapEl, {
      center: { lat: 46.603354, lng: 1.888334 }, // Centre de la France
      zoom: 6,
      styles: DARK_MAP_STYLES,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER,
      },
    });

    this.clickListener = this.map.addListener(
      "click",
      (e: google.maps.MapMouseEvent) => {
        if (e.latLng) {
          this.handleMapClick(e.latLng);
        }
      },
    );
  }

  // ─── Click handler (called externally with currentMode from RouteUI) ────────

  /** The RouteUI sets this before each click so MapController knows the mode. */
  public currentMode: SegmentMode = "route";

  private async handleMapClick(latLng: google.maps.LatLng): Promise<void> {
    const label = String.fromCharCode(65 + this.internalWaypoints.length); // A, B, C…
    const waypoint: Waypoint = {
      lat: latLng.lat(),
      lng: latLng.lng(),
      label,
      segmentMode: this.currentMode,
    };

    await this.addWaypoint(waypoint);
  }

  // ─── Add waypoint ───────────────────────────────────────────────────────────

  async addWaypoint(waypoint: Waypoint): Promise<void> {
    if (!this.map) return;

    const isFirst = this.internalWaypoints.length === 0;
    const marker = new google.maps.Marker({
      position: { lat: waypoint.lat, lng: waypoint.lng },
      map: this.map,
      icon: createMarkerIcon(waypoint.label, isFirst),
      zIndex: 10,
    });

    let segment: ResolvedSegment | null = null;
    let polyline: google.maps.Polyline | null = null;

    if (!isFirst) {
      const prevInternal = this.internalWaypoints[this.internalWaypoints.length - 1]!;
      const prevWaypoint: Waypoint = {
        lat: prevInternal.lat,
        lng: prevInternal.lng,
        label: prevInternal.label,
        segmentMode: prevInternal.segmentMode,
      };

      this.onLoadingChange?.(true);
      try {
        segment = await resolveSegment(prevWaypoint, waypoint, this.travelMode);
        polyline = this.drawSegment(segment);
      } catch (err) {
        marker.setMap(null);
        this.onLoadingChange?.(false);
        if (err instanceof RoutingError) {
          this.onError?.(err.message);
        } else {
          this.onError?.("Erreur inattendue lors du calcul d'itinéraire.");
        }
        return;
      } finally {
        this.onLoadingChange?.(false);
      }
    }

    this.internalWaypoints.push({ ...waypoint, marker, segment, polyline });
    this.notifyChange();
  }

  // ─── Draw polyline ──────────────────────────────────────────────────────────

  private drawSegment(segment: ResolvedSegment): google.maps.Polyline {
    const options =
      segment.mode === "route"
        ? ROUTE_POLYLINE_OPTIONS
        : straightPolylineOptions();

    const polyline = new google.maps.Polyline({
      path: segment.path,
      map: this.map!,
      ...options,
    });

    return polyline;
  }

  // ─── Remove last waypoint ───────────────────────────────────────────────────

  removeLastWaypoint(): void {
    const last = this.internalWaypoints.pop();
    if (!last) return;

    last.marker.setMap(null);
    last.polyline?.setMap(null);

    this.notifyChange();
  }

  // ─── Clear all ──────────────────────────────────────────────────────────────

  clearAll(): void {
    for (const wp of this.internalWaypoints) {
      wp.marker.setMap(null);
      wp.polyline?.setMap(null);
    }
    this.internalWaypoints = [];
    this.notifyChange();
  }

  // ─── Travel mode ────────────────────────────────────────────────────────────

  setTravelMode(mode: google.maps.TravelMode): void {
    this.travelMode = mode;
  }

  getTravelMode(): google.maps.TravelMode {
    return this.travelMode;
  }

  // ─── Accessors ──────────────────────────────────────────────────────────────

  getWaypoints(): Waypoint[] {
    return this.internalWaypoints.map((w) => ({
      lat: w.lat,
      lng: w.lng,
      label: w.label,
      segmentMode: w.segmentMode,
    }));
  }

  getSegments(): ResolvedSegment[] {
    return this.internalWaypoints
      .filter((w) => w.segment !== null)
      .map((w) => w.segment!);
  }

  getWaypointCount(): number {
    return this.internalWaypoints.length;
  }

  // ─── Notify ─────────────────────────────────────────────────────────────────

  private notifyChange(): void {
    this.onWaypointsChanged?.(this.getWaypoints(), this.getSegments());
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.clickListener) {
      google.maps.event.removeListener(this.clickListener);
      this.clickListener = null;
    }
    this.clearAll();
    this.map = null;
  }
}

// ─── Dynamic Google Maps script loader ───────────────────────────────────────

let scriptLoadPromise: Promise<void> | null = null;

/**
 * Dynamically injects the Google Maps JS API script tag and waits for it to
 * load. Idempotent — calling it twice with the same key is safe.
 */
export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  // Already loaded
  if (typeof google !== "undefined" && typeof google.maps !== "undefined") {
    return Promise.resolve();
  }

  // Already in flight
  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const callbackName = "__googleMapsInitCallback";

    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      resolve();
    };

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&callback=${callbackName}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      scriptLoadPromise = null;
      reject(new Error("Impossible de charger l'API Google Maps. Vérifie ta connexion internet et ta clé API."));
    };

    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}
