/**
 * MapController — manages the map display layer (Google Maps OR Leaflet/OSM)
 * while always loading Google Maps SDK headlessly for routing (DirectionsService)
 * and geometry (spherical distance for snap tool).
 *
 * Supports multiple polygons with layer management and snap/magnet tool.
 */

import * as L from "leaflet";
import turfUnion from "@turf/union";
import { polygon as turfPolygon, featureCollection } from "@turf/helpers";
import { resolveSegment, RoutingError } from "./SegmentRouter.ts";
import type { SegmentMode, Waypoint, ResolvedSegment } from "./SegmentRouter.ts";
import { douglasPeucker } from "./KmlImporter.ts";

export type { SegmentMode, Waypoint, ResolvedSegment };
export type MapProvider = "google" | "osm";

// ─── Internal types ───────────────────────────────────────────────────────────

type AnyMarker = google.maps.Marker | L.Marker;
type AnyPolyline = google.maps.Polyline | L.Polyline;
type AnyPolygon = google.maps.Polygon | L.Polygon;
type VertexMarker = google.maps.Marker | L.CircleMarker;

interface WaypointInternal extends Waypoint {
  marker: AnyMarker;
  segment: ResolvedSegment | null;
  polyline: AnyPolyline | null;
}

interface PolygonGroup {
  id: string;
  name: string;
  collapsed: boolean;
  kind: "drawn" | "imported";
  /** Manually created groups persist even when empty. */
  persistent: boolean;
}

interface PolygonData {
  id: string;
  name: string;
  color: string;
  textColor: string;
  kind: "drawn" | "imported";
  groupId: string;
  waypoints: WaypointInternal[];
  closingPolyline: AnyPolyline | null;
  closingSegment: ResolvedSegment | null;
  fillPolygon: AnyPolygon | null;
  isClosed: boolean;
  /** Raw coordinate ring for imported polygons (no waypoint markers). */
  rawCoordinates?: { lat: number; lng: number }[];
  /** Last epsilon used by simplifyPolygon (doubled on each call). */
  simplifyEpsilon?: number;
  /** Original coords before first simplification — used to restore. */
  preSimplifyCoordinates?: { lat: number; lng: number }[];
  /** Vertex edit mode state (imported polygons only). */
  vertexEditActive?: boolean;
  vertexMarkers?: VertexMarker[];
  edgePolylines?: AnyPolyline[];
}

export interface PolygonInfo {
  id: string;
  name: string;
  color: string;
  isClosed: boolean;
  waypointCount: number;
  isActive: boolean;
  isImported: boolean;
  vertexCount?: number;
  vertexEditActive: boolean;
  isSelected: boolean;
  canRestoreSimplify: boolean;
}

export interface GroupInfo {
  id: string;
  name: string;
  collapsed: boolean;
  kind: "drawn" | "imported";
  polygons: PolygonInfo[];
}

export interface PolygonExportData {
  name: string;
  color: string;
  segments: ResolvedSegment[];
  /** For imported polygons — used instead of segments when present. */
  rawCoordinates?: { lat: number; lng: number }[];
}

// ─── Undo / Split types ───────────────────────────────────────────────────────

interface SavedPolygonData {
  id: string;
  name: string;
  color: string;
  textColor: string;
  groupId: string;
  groupName: string;
  groupKind: "drawn" | "imported";
  groupPersistent: boolean;
  rawCoordinates: { lat: number; lng: number }[];
}

interface UndoOperation {
  type: "merge" | "split";
  deletedPolygons: SavedPolygonData[];
  createdPolygonIds: string[];
  groupsCreated: string[];
}

interface SplitState {
  active: boolean;
  sourcePolygonId: string;
  startPoint: { lat: number; lng: number } | null;
  startContourIndex: number;
  dividingSegments: ResolvedSegment[];
  dividingPolylines: AnyPolyline[];
  startMarkerG: google.maps.Marker | null;
  startMarkerL: L.CircleMarker | null;
  snapWasActive: boolean;
}

/** Distance in metres below which two borders are considered shared (routing precision). */
const MERGE_SNAP_DISTANCE_METERS = 5;

// ─── Color palette ────────────────────────────────────────────────────────────

const POLYGON_PALETTE: Array<[string, string]> = [
  ["#00e5a0", "#0f1117"],
  ["#4a90d9", "#ffffff"],
  ["#f5a623", "#0f1117"],
  ["#e74c3c", "#ffffff"],
  ["#9b59b6", "#ffffff"],
  ["#f1c40f", "#0f1117"],
];

function polygonColor(index: number): { color: string; textColor: string } {
  const pair = POLYGON_PALETTE[index % POLYGON_PALETTE.length]!;
  return { color: pair[0], textColor: pair[1] };
}

// ─── Google Maps styles & polyline options ────────────────────────────────────

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

function gRoutePolylineOptions(color: string, opacity = 1): google.maps.PolylineOptions {
  return { strokeColor: color, strokeWeight: 3, strokeOpacity: opacity, zIndex: 2 };
}

function gStraightPolylineOptions(color: string, opacity = 1): google.maps.PolylineOptions {
  return {
    strokeColor: color, strokeWeight: 2, strokeOpacity: 0, zIndex: 1,
    icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: opacity, strokeColor: color, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "10px" }],
  };
}

// ─── OSM tile providers ───────────────────────────────────────────────────────

const TILE_LAYERS = {
  dark: { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' },
  light: { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
  satellite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: "Tiles &copy; Esri" },
  terrain: { url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' },
};

// ─── Marker icons ─────────────────────────────────────────────────────────────

function markerSvg(label: string, color: string, textColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.59 14.374 23.05 15.015 23.596a1.5 1.5 0 0 0 1.97 0C17.626 39.05 32 26.59 32 16 32 7.163 24.837 0 16 0z" fill="${color}"/>
    <text x="16" y="20" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="700" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
}

function markerEditSvg(label: string, color: string, textColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
    <path d="M19 0C9.059 0 1 8.059 1 18c0 11.912 16.17 25.938 17.092 26.748a1.5 1.5 0 0 0 1.816 0C20.83 43.938 37 29.912 37 18 37 8.059 28.941 0 19 0z" fill="#fbbf24"/>
    <path d="M19 3.5C11.268 3.5 5 9.768 5 17.5c0 9.548 12.374 21.15 13.015 21.746a1.5 1.5 0 0 0 1.97 0C20.626 38.65 33 27.048 33 17.5 33 9.768 26.732 3.5 19 3.5z" fill="${color}"/>
    <text x="19" y="21" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="700" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
}

function gMarkerIcon(label: string, color: string, textColor: string): google.maps.Icon {
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markerSvg(label, color, textColor))}`, scaledSize: new google.maps.Size(32, 40), anchor: new google.maps.Point(16, 40) };
}

function gMarkerIconEdit(label: string, color: string, textColor: string): google.maps.Icon {
  return { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(markerEditSvg(label, color, textColor))}`, scaledSize: new google.maps.Size(38, 46), anchor: new google.maps.Point(19, 46) };
}

function lMarkerIcon(label: string, color: string, textColor: string): L.DivIcon {
  return L.divIcon({ html: markerSvg(label, color, textColor), className: "", iconSize: [32, 40], iconAnchor: [16, 40] });
}

function lMarkerIconEdit(label: string, color: string, textColor: string): L.DivIcon {
  return L.divIcon({ html: markerEditSvg(label, color, textColor), className: "", iconSize: [38, 46], iconAnchor: [19, 46] });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function toLL(p: google.maps.LatLng): [number, number] {
  return [p.lat(), p.lng()];
}

// ─── MapController ────────────────────────────────────────────────────────────

export class MapController {
  private provider: MapProvider = "google";

  // Google Maps display
  private gMap: google.maps.Map | null = null;
  private gClickListener: google.maps.MapsEventListener | null = null;
  private gMouseMoveListener: google.maps.MapsEventListener | null = null;

  // Leaflet display
  private lMap: L.Map | null = null;
  private lTileLayer: L.TileLayer | null = null;
  private lClickHandler: ((e: L.LeafletMouseEvent) => void) | null = null;
  private lMouseMoveHandler: ((e: L.LeafletMouseEvent) => void) | null = null;

  private groups: PolygonGroup[] = [];
  private polygons: PolygonData[] = [];
  private activeIndex = 0;
  private travelMode = "DRIVING" as google.maps.TravelMode;
  // Prevents the map click handler from firing a waypoint add when a fill
  // polygon click (Google Maps) selects a polygon — the two events are
  // independent and both fire; this flag swallows the map click.
  private ignoreNextMapClick = false;

  // Snap / magnet tool
  private snapMarkerG: google.maps.Marker | null = null;
  private snapMarkerL: L.CircleMarker | null = null;
  private snapTarget: google.maps.LatLng | null = null;
  private snapMode = false;

  // Multi-select
  private selectedPolygonIds: Set<string> = new Set();

  // Undo stack (merge / split operations)
  private undoStack: UndoOperation[] = [];

  // Split mode state
  private splitState: SplitState = {
    active: false, sourcePolygonId: "", startPoint: null, startContourIndex: -1,
    dividingSegments: [], dividingPolylines: [],
    startMarkerG: null, startMarkerL: null, snapWasActive: false,
  };

  // Callbacks wired up by RouteUI
  public onWaypointsChanged: ((waypoints: Waypoint[], segments: ResolvedSegment[]) => void) | null = null;
  public onPolygonsChanged: ((groups: GroupInfo[]) => void) | null = null;
  public onError: ((message: string) => void) | null = null;
  public onLoadingChange: ((loading: boolean) => void) | null = null;
  public onClosedChanged: ((closed: boolean) => void) | null = null;

  // ─── Map initialisation ────────────────────────────────────────────────────

  getViewState(): { center: { lat: number; lng: number }; zoom: number } | null {
    if (this.gMap) {
      const c = this.gMap.getCenter();
      if (!c) return null;
      return { center: { lat: c.lat(), lng: c.lng() }, zoom: this.gMap.getZoom() ?? 6 };
    }
    if (this.lMap) {
      const c = this.lMap.getCenter();
      return { center: { lat: c.lat, lng: c.lng }, zoom: this.lMap.getZoom() };
    }
    return null;
  }

  async init(
    apiKey: string,
    mapEl: HTMLElement,
    provider: MapProvider = "google",
    initialView?: { center: { lat: number; lng: number }; zoom: number },
  ): Promise<void> {
    this.provider = provider;

    // loadGoogleMapsScript sets its own gm_authFailure during script loading.
    // We wait for it to finish, THEN set our handler so it isn't overwritten.
    await loadGoogleMapsScript(apiKey);

    // Auth check only happens when a Map is created — set handler now, after script loaded.
    const authFailure = new Promise<never>((_, reject) => {
      (window as unknown as Record<string, unknown>)["gm_authFailure"] = () => {
        reject(new Error(
          "Clé API invalide ou APIs non activées. Vérifie que Maps JavaScript API et Directions API sont activées dans Google Cloud Console.",
        ));
      };
    });

    if (provider === "google") {
      // Validate auth with an off-screen element above the landing overlay (z-index:101).
      // Google Maps needs a visible container for IntersectionObserver to work.
      await this.validateGoogleAuth(authFailure);
      // Auth confirmed — create the real map (synchronous, landing will be hidden by caller)
      this.createGoogleMap(mapEl, initialView);
    } else {
      this.createLeafletMap(mapEl, initialView);
    }
  }

  /** Renders a temporary invisible map above the landing to confirm the key is valid. */
  private async validateGoogleAuth(authFailure: Promise<never>): Promise<void> {
    const tmpEl = document.createElement("div");
    // z-index:101 puts it above the landing overlay (z-index:100) so Google Maps can observe it
    tmpEl.style.cssText =
      "position:fixed;z-index:101;top:0;left:0;width:400px;height:300px;opacity:0;pointer-events:none;";
    document.body.appendChild(tmpEl);
    try {
      const tmpMap = new google.maps.Map(tmpEl, {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6,
        disableDefaultUI: true,
      });
      await Promise.race([
        new Promise<void>((resolve) => {
          google.maps.event.addListenerOnce(tmpMap, "tilesloaded", resolve);
        }),
        authFailure,
      ]);
    } finally {
      document.body.removeChild(tmpEl);
    }
  }

  private createGoogleMap(
    mapEl: HTMLElement,
    initialView?: { center: { lat: number; lng: number }; zoom: number },
  ): void {
    this.gMap = new google.maps.Map(mapEl, {
      center: initialView?.center ?? { lat: 46.603354, lng: 1.888334 },
      zoom: initialView?.zoom ?? 6,
      styles: DARK_MAP_STYLES,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
      draggableCursor: "crosshair",
    });
    this.gClickListener = this.gMap.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (e.latLng) this.handleMapClick(e.latLng);
    });
  }

  private createLeafletMap(
    mapEl: HTMLElement,
    initialView?: { center: { lat: number; lng: number }; zoom: number },
  ): void {
    const center: L.LatLngExpression = initialView
      ? [initialView.center.lat, initialView.center.lng]
      : [46.603354, 1.888334];
    this.lMap = L.map(mapEl, { center, zoom: initialView?.zoom ?? 6, zoomControl: true });
    const { url, attribution } = TILE_LAYERS.dark;
    this.lTileLayer = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(this.lMap);
    this.lMap.getContainer().style.cursor = "crosshair";
    this.lClickHandler = (e: L.LeafletMouseEvent) => {
      this.handleMapClick(new google.maps.LatLng(e.latlng.lat, e.latlng.lng));
    };
    this.lMap.on("click", this.lClickHandler);
  }

  // ─── Display dispatch helpers ──────────────────────────────────────────────

  private get isOsm(): boolean { return this.provider === "osm"; }

  private removeObj(obj: AnyMarker | AnyPolyline | AnyPolygon | L.CircleMarker | null): void {
    if (!obj) return;
    if (obj instanceof L.Layer) { obj.remove(); }
    else { (obj as { setMap: (m: null) => void }).setMap(null); }
  }

  private makeMarker(lat: number, lng: number, label: string, color: string, textColor: string): AnyMarker {
    if (!this.isOsm) {
      return new google.maps.Marker({ position: { lat, lng }, map: this.gMap!, icon: gMarkerIcon(label, color, textColor), zIndex: 10 });
    }
    return L.marker([lat, lng], { icon: lMarkerIcon(label, color, textColor), zIndexOffset: 1000 }).addTo(this.lMap!);
  }

  private setMarkerIcon(marker: AnyMarker, label: string, color: string, textColor: string, edit = false): void {
    if (marker instanceof L.Marker) {
      marker.setIcon(edit ? lMarkerIconEdit(label, color, textColor) : lMarkerIcon(label, color, textColor));
    } else {
      (marker as google.maps.Marker).setIcon(edit ? gMarkerIconEdit(label, color, textColor) : gMarkerIcon(label, color, textColor));
    }
  }

  private enableDrag(marker: AnyMarker): void {
    if (marker instanceof L.Marker) { marker.dragging?.enable(); }
    else { (marker as google.maps.Marker).setDraggable(true); }
  }

  private disableDrag(marker: AnyMarker): void {
    if (marker instanceof L.Marker) { marker.dragging?.disable(); }
    else { (marker as google.maps.Marker).setDraggable(false); }
  }

  private makePolyline(segment: ResolvedSegment, color: string, opacity = 1): AnyPolyline {
    if (!this.isOsm) {
      const opts = segment.mode === "route" ? gRoutePolylineOptions(color, opacity) : gStraightPolylineOptions(color, opacity);
      return new google.maps.Polyline({ path: segment.path, map: this.gMap!, ...opts });
    }
    const lOpts: L.PolylineOptions = segment.mode === "route"
      ? { color, weight: 3, opacity }
      : { color, weight: 2, opacity, dashArray: "8, 10" };
    return L.polyline(segment.path.map(toLL), lOpts).addTo(this.lMap!);
  }

  private setPolylineOpacity(polyline: AnyPolyline | null, opacity: number, mode: SegmentMode, color: string): void {
    if (!polyline) return;
    if (polyline instanceof L.Polyline) {
      polyline.setStyle({ opacity });
    } else {
      const gp = polyline as google.maps.Polyline;
      if (mode === "route") {
        gp.setOptions({ strokeOpacity: opacity });
      } else {
        gp.setOptions({ icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: opacity, strokeColor: color, strokeWeight: 2, scale: 3 }, offset: "0", repeat: "10px" }] });
      }
    }
  }

  private makeFillPolygon(path: [number, number][], color: string): AnyPolygon {
    if (!this.isOsm) {
      return new google.maps.Polygon({ paths: path.map(([lat, lng]) => ({ lat, lng })), map: this.gMap!, fillColor: color, fillOpacity: 0.15, strokeWeight: 0, zIndex: 0 });
    }
    return L.polygon(path, { fillColor: color, fillOpacity: 0.15, weight: 0 }).addTo(this.lMap!);
  }

  private addFillClickHandler(fillPoly: AnyPolygon, id: string): void {
    if (fillPoly instanceof L.Polygon) {
      fillPoly.on("click", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        if (this.splitState.active) {
          // Forward click coordinates to split handler
          const ll = { lat: () => e.latlng.lat, lng: () => e.latlng.lng };
          void this.handleSplitClick(ll);
          return;
        }
        const ctrlKey = e.originalEvent.ctrlKey || e.originalEvent.metaKey;
        this.selectPolygon(id, ctrlKey);
      });
    } else {
      (fillPoly as google.maps.Polygon).addListener("click", (e: google.maps.PolyMouseEvent) => {
        if (this.splitState.active) {
          // Forward click coordinates to split handler (polygon click doesn't bubble to map)
          if (e.latLng) void this.handleSplitClick(e.latLng);
          return;
        }
        this.ignoreNextMapClick = true;
        setTimeout(() => { this.ignoreNextMapClick = false; }, 50);
        const ctrlKey = !!(e.domEvent as MouseEvent)?.ctrlKey || !!(e.domEvent as MouseEvent)?.metaKey;
        this.selectPolygon(id, ctrlKey);
      });
    }
  }

  private updateFillPath(polygon: AnyPolygon, path: [number, number][]): void {
    if (polygon instanceof L.Polygon) {
      polygon.setLatLngs(path);
    } else {
      (polygon as google.maps.Polygon).setPaths([path.map(([lat, lng]) => ({ lat, lng }))]);
    }
  }

  private setFillOpacity(polygon: AnyPolygon | null, opacity: number): void {
    if (!polygon) return;
    if (polygon instanceof L.Polygon) { polygon.setStyle({ fillOpacity: opacity }); }
    else { (polygon as google.maps.Polygon).setOptions({ fillOpacity: opacity }); }
  }

  private setFillStroke(polygon: AnyPolygon | null, weight: number, color: string): void {
    if (!polygon) return;
    if (polygon instanceof L.Polygon) { polygon.setStyle({ weight, color }); }
    else { (polygon as google.maps.Polygon).setOptions({ strokeWeight: weight, strokeColor: color }); }
  }

  // ─── Active polygon accessor ───────────────────────────────────────────────

  private get active(): PolygonData {
    return this.polygons[this.activeIndex]!;
  }

  public currentMode: SegmentMode = "route";

  // ─── Click handler ─────────────────────────────────────────────────────────

  private async handleMapClick(rawLatLng: google.maps.LatLng): Promise<void> {
    if (this.ignoreNextMapClick) { this.ignoreNextMapClick = false; return; }
    if (this.polygons.length === 0) return;

    // Split mode intercepts all map clicks
    if (this.splitState.active) {
      await this.handleSplitClick(rawLatLng);
      return;
    }

    const poly = this.active;
    if (poly.isClosed) return;
    const latLng = this.snapTarget ?? rawLatLng;
    this.snapTarget = null;

    const label = String.fromCharCode(65 + poly.waypoints.length);
    await this.addWaypoint({ lat: latLng.lat(), lng: latLng.lng(), label, segmentMode: this.currentMode });
  }

  // ─── Add waypoint ──────────────────────────────────────────────────────────

  async addWaypoint(waypoint: Waypoint): Promise<void> {
    const poly = this.active;
    if (poly.isClosed) return;

    const isFirst = poly.waypoints.length === 0;
    const marker = this.makeMarker(waypoint.lat, waypoint.lng, waypoint.label, poly.color, poly.textColor);

    if (isFirst) {
      let pendingClose: ReturnType<typeof setTimeout> | null = null;
      const onClickFirst = () => {
        if (poly.waypoints.length >= 3 && !poly.isClosed) {
          pendingClose = setTimeout(() => {
            pendingClose = null;
            this.closePolygon().catch((err) => {
              this.onError?.(err instanceof Error ? err.message : "Erreur lors de la fermeture du polygone.");
            });
          }, 250);
        }
      };
      const onDblClickFirst = () => {
        if (pendingClose) { clearTimeout(pendingClose); pendingClose = null; }
      };
      if (marker instanceof L.Marker) {
        marker.on("click", onClickFirst);
        marker.on("dblclick", onDblClickFirst);
      } else {
        (marker as google.maps.Marker).addListener("click", onClickFirst);
        (marker as google.maps.Marker).addListener("dblclick", onDblClickFirst);
      }
    }

    let segment: ResolvedSegment | null = null;
    let polyline: AnyPolyline | null = null;

    if (!isFirst) {
      const prev = poly.waypoints[poly.waypoints.length - 1]!;
      const prevWaypoint: Waypoint = { lat: prev.lat, lng: prev.lng, label: prev.label, segmentMode: prev.segmentMode };

      this.onLoadingChange?.(true);
      try {
        segment = await resolveSegment(prevWaypoint, waypoint, this.travelMode);
        polyline = this.makePolyline(segment, poly.color);
      } catch (err) {
        this.removeObj(marker);
        this.onLoadingChange?.(false);
        if (err instanceof RoutingError) { this.onError?.(err.message); }
        else { this.onError?.("Erreur inattendue lors du calcul d'itinéraire."); }
        return;
      } finally {
        this.onLoadingChange?.(false);
      }
    }

    poly.waypoints.push({ ...waypoint, marker, segment, polyline });
    this.setupMarkerDragEdit(poly, poly.waypoints.length - 1);
    this.notifyChange();
  }

  // ─── Marker drag-edit ──────────────────────────────────────────────────────

  private setupMarkerDragEdit(poly: PolygonData, wpIndex: number): void {
    const wp = poly.waypoints[wpIndex]!;
    let editing = false;

    const onDblClick = () => {
      if (editing) return;
      editing = true;
      this.enableDrag(wp.marker);
      this.setMarkerIcon(wp.marker, wp.label, poly.color, poly.textColor, true);
    };

    const onDragEnd = async (e: L.DragEndEvent | google.maps.MapMouseEvent) => {
      if (!editing) return;
      editing = false;
      this.disableDrag(wp.marker);
      this.setMarkerIcon(wp.marker, wp.label, poly.color, poly.textColor, false);

      if (wp.marker instanceof L.Marker) {
        const pos = (wp.marker as L.Marker).getLatLng();
        wp.lat = pos.lat;
        wp.lng = pos.lng;
      } else {
        const pos = (e as google.maps.MapMouseEvent).latLng;
        if (pos) { wp.lat = pos.lat(); wp.lng = pos.lng(); }
      }

      this.onLoadingChange?.(true);
      try { await this.recalcAdjacentSegments(poly, wpIndex); }
      catch (err) { this.onError?.(err instanceof Error ? err.message : "Erreur lors de la mise à jour du point."); }
      finally { this.onLoadingChange?.(false); }

      this.notifyChange();
      this.notifyPolygonsChanged();
    };

    if (wp.marker instanceof L.Marker) {
      wp.marker.on("dblclick", onDblClick);
      wp.marker.on("dragend", onDragEnd as (e: L.DragEndEvent) => void);
    } else {
      (wp.marker as google.maps.Marker).addListener("dblclick", onDblClick);
      (wp.marker as google.maps.Marker).addListener("dragend", onDragEnd);
    }
  }

  // ─── Recalculate segments around a moved waypoint ─────────────────────────

  private async recalcAdjacentSegments(poly: PolygonData, wpIndex: number): Promise<void> {
    const wp = poly.waypoints[wpIndex]!;
    const thisWp: Waypoint = { lat: wp.lat, lng: wp.lng, label: wp.label, segmentMode: wp.segmentMode };

    if (wpIndex > 0) {
      const prev = poly.waypoints[wpIndex - 1]!;
      this.removeObj(wp.polyline);
      const seg = await resolveSegment({ lat: prev.lat, lng: prev.lng, label: prev.label, segmentMode: prev.segmentMode }, thisWp, this.travelMode);
      wp.segment = seg;
      wp.polyline = this.makePolyline(seg, poly.color);
    }

    if (wpIndex < poly.waypoints.length - 1) {
      const next = poly.waypoints[wpIndex + 1]!;
      this.removeObj(next.polyline);
      const seg = await resolveSegment(thisWp, { lat: next.lat, lng: next.lng, label: next.label, segmentMode: next.segmentMode }, this.travelMode);
      next.segment = seg;
      next.polyline = this.makePolyline(seg, poly.color);
    }

    if (poly.isClosed && (wpIndex === 0 || wpIndex === poly.waypoints.length - 1)) {
      const first = poly.waypoints[0]!;
      const last = poly.waypoints[poly.waypoints.length - 1]!;
      this.removeObj(poly.closingPolyline);
      const seg = await resolveSegment(
        { lat: last.lat, lng: last.lng, label: last.label, segmentMode: last.segmentMode },
        { lat: first.lat, lng: first.lng, label: first.label, segmentMode: poly.closingSegment?.mode ?? "route" },
        this.travelMode,
      );
      poly.closingPolyline = this.makePolyline(seg, poly.color);
      poly.closingSegment = seg;
    }

    if (poly.isClosed) this.rebuildFillPolygon(poly);
  }

  // ─── Rebuild fill polygon ──────────────────────────────────────────────────

  private buildFillPath(poly: PolygonData): [number, number][] {
    const path: [number, number][] = [];
    for (const wp of poly.waypoints) {
      if (wp.segment) {
        const start = path.length === 0 ? 0 : 1;
        for (let j = start; j < wp.segment.path.length; j++) path.push(toLL(wp.segment.path[j]!));
      } else {
        path.push([wp.lat, wp.lng]);
      }
    }
    if (poly.closingSegment) {
      for (let j = 1; j < poly.closingSegment.path.length; j++) path.push(toLL(poly.closingSegment.path[j]!));
    }
    return path;
  }

  private rebuildFillPolygon(poly: PolygonData): void {
    if (!poly.closingSegment) return;
    const path = this.buildFillPath(poly);
    if (poly.fillPolygon) { this.updateFillPath(poly.fillPolygon, path); }
    else {
      poly.fillPolygon = this.makeFillPolygon(path, poly.color);
      this.addFillClickHandler(poly.fillPolygon, poly.id);
    }
  }

  // ─── Polygon closure ───────────────────────────────────────────────────────

  private async closePolygon(): Promise<void> {
    const poly = this.active;
    if (poly.waypoints.length < 3) return;

    const first = poly.waypoints[0]!;
    const last = poly.waypoints[poly.waypoints.length - 1]!;

    this.onLoadingChange?.(true);
    try {
      const segment = await resolveSegment(
        { lat: last.lat, lng: last.lng, label: last.label, segmentMode: last.segmentMode },
        { lat: first.lat, lng: first.lng, label: first.label, segmentMode: this.currentMode },
        this.travelMode,
      );
      poly.closingPolyline = this.makePolyline(segment, poly.color);
      poly.closingSegment = segment;
      poly.fillPolygon = this.makeFillPolygon(this.buildFillPath(poly), poly.color);
      this.addFillClickHandler(poly.fillPolygon, poly.id);
      poly.isClosed = true;
      this.onClosedChanged?.(true);
      this.notifyChange();
      this.notifyPolygonsChanged();
    } finally {
      this.onLoadingChange?.(false);
    }
  }

  private openPolygon(): void {
    const poly = this.active;
    this.removeObj(poly.closingPolyline); poly.closingPolyline = null; poly.closingSegment = null;
    this.removeObj(poly.fillPolygon); poly.fillPolygon = null;
    poly.isClosed = false;
    this.onClosedChanged?.(false);
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  // ─── Remove last waypoint ──────────────────────────────────────────────────

  removeLastWaypoint(): void {
    if (this.polygons.length === 0) return;
    const poly = this.active;
    if (poly.kind === "imported") return;
    if (poly.isClosed) { this.openPolygon(); return; }
    const last = poly.waypoints.pop();
    if (!last) return;
    this.removeObj(last.marker);
    this.removeObj(last.polyline);
    this.notifyChange();
  }

  // ─── Clear active polygon ──────────────────────────────────────────────────

  clearAll(): void {
    if (this.polygons.length === 0) return;
    const poly = this.active;
    if (poly.kind === "imported") { this.deletePolygon(poly.id); return; }
    this.clearPolygonMapObjects(poly);
    const wasClosed = poly.isClosed;
    poly.closingPolyline = null; poly.closingSegment = null; poly.fillPolygon = null;
    poly.isClosed = false; poly.waypoints = [];
    if (wasClosed) this.onClosedChanged?.(false);
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  // ─── Polygon management ────────────────────────────────────────────────────

  private nextPolygonName(): string {
    const last = this.polygons.at(-1)?.name;
    if (last) {
      const m = last.match(/^([\s\S]*?)(\d+)$/);
      if (m) {
        const prefix = m[1]!;
        const digits = m[2]!;
        const next = String(Number(digits) + 1).padStart(digits.length, "0");
        return prefix + next;
      }
    }
    return `Polygone ${this.polygons.length + 1}`;
  }

  addPolygon(): string {
    const current = this.polygons[this.activeIndex];
    if (current?.vertexEditActive) this.deactivateVertexEdit(current);
    const groupId = this.ensureDrawnGroup();
    const index = this.polygons.length;
    const { color, textColor } = polygonColor(index);
    const id = crypto.randomUUID();
    this.polygons.push({ id, name: this.nextPolygonName(), color, textColor, kind: "drawn", groupId, waypoints: [], closingPolyline: null, closingSegment: null, fillPolygon: null, isClosed: false });
    this.activeIndex = this.polygons.length - 1;
    this.selectedPolygonIds.clear();
    this.selectedPolygonIds.add(id);
    this.notifyChange();
    this.notifyPolygonsChanged();
    return id;
  }

  setActivePolygon(id: string): void {
    this.selectPolygon(id, false);
  }

  /** Select a polygon. If addToSelection is true (Ctrl+click), toggles multi-select. */
  selectPolygon(id: string, addToSelection: boolean): void {
    const idx = this.polygons.findIndex((p) => p.id === id);
    if (idx === -1) return;

    if (!addToSelection) {
      if (idx === this.activeIndex && this.selectedPolygonIds.size === 1 && this.selectedPolygonIds.has(id)) return;
      const current = this.polygons[this.activeIndex];
      if (current?.vertexEditActive) this.deactivateVertexEdit(current);
      this.selectedPolygonIds.clear();
      this.selectedPolygonIds.add(id);
      this.activeIndex = idx;
      this.updateHighlights();
      this.onClosedChanged?.(this.active.isClosed);
      this.notifyChange();
      this.notifyPolygonsChanged();
    } else {
      if (this.selectedPolygonIds.has(id)) {
        this.selectedPolygonIds.delete(id);
        if (this.selectedPolygonIds.size === 0) {
          this.selectedPolygonIds.add(id); // can't deselect everything
        } else if (idx === this.activeIndex) {
          const firstId = [...this.selectedPolygonIds][0]!;
          this.activeIndex = this.polygons.findIndex((p) => p.id === firstId);
          this.onClosedChanged?.(this.active.isClosed);
        }
      } else {
        this.selectedPolygonIds.add(id);
        this.activeIndex = idx;
        this.onClosedChanged?.(this.active.isClosed);
      }
      this.updateHighlights();
      this.notifyPolygonsChanged();
    }
  }

  getSelectedPolygonIds(): string[] { return [...this.selectedPolygonIds]; }
  getUndoStackSize(): number { return this.undoStack.length; }
  get splitModeActive(): boolean { return this.splitState.active; }
  get splitStartSet(): boolean { return this.splitState.startPoint !== null; }

  renamePolygon(id: string, name: string): void {
    const poly = this.polygons.find((p) => p.id === id);
    if (!poly || !name.trim()) return;
    poly.name = name.trim();
    this.notifyPolygonsChanged();
  }

  deletePolygon(id: string): void {
    const idx = this.polygons.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const { groupId } = this.polygons[idx]!;
    this.clearPolygonMapObjects(this.polygons[idx]!);
    this.polygons.splice(idx, 1);
    this.selectedPolygonIds.delete(id);
    // Remove non-persistent group if it is now empty
    if (!this.polygons.some((p) => p.groupId === groupId)) {
      const grp = this.groups.find((g) => g.id === groupId);
      if (grp && !grp.persistent) this.groups = this.groups.filter((g) => g.id !== groupId);
    }
    if (this.polygons.length === 0) {
      this.activeIndex = 0;
      this.selectedPolygonIds.clear();
      this.onClosedChanged?.(false);
    } else {
      if (this.activeIndex >= this.polygons.length) this.activeIndex = this.polygons.length - 1;
      // Ensure active polygon is in selection
      if (this.selectedPolygonIds.size === 0) {
        const activeId = this.polygons[this.activeIndex]?.id;
        if (activeId) this.selectedPolygonIds.add(activeId);
      }
      this.onClosedChanged?.(this.active.isClosed);
    }
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  getPolygons(): PolygonInfo[] {
    return this.polygons.map((p, i) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isClosed: p.isClosed,
      waypointCount: p.waypoints.length,
      isActive: i === this.activeIndex,
      isImported: p.kind === "imported",
      vertexCount: p.kind === "imported" ? p.rawCoordinates?.length : undefined,
      vertexEditActive: p.vertexEditActive ?? false,
      isSelected: this.selectedPolygonIds.has(p.id),
      canRestoreSimplify: !!p.preSimplifyCoordinates,
    }));
  }

  // ─── Group management ──────────────────────────────────────────────────────

  /** Returns the id of the "Tracés" drawn group, creating it if needed. */
  private ensureDrawnGroup(): string {
    const existing = this.groups.find((g) => g.kind === "drawn");
    if (existing) return existing.id;
    const group: PolygonGroup = { id: "drawn", name: "Tracés", collapsed: false, kind: "drawn", persistent: false };
    this.groups.push(group);
    return group.id;
  }

  /** Creates a new imported group and returns its id. */
  private createImportGroup(name: string): string {
    const id = crypto.randomUUID();
    const truncated = name.slice(0, 30);
    this.groups.push({ id, name: truncated, collapsed: false, kind: "imported", persistent: false });
    return id;
  }

  /** Publicly creates a named group (persistent — survives being empty). Returns its id. */
  addGroup(name: string): string {
    const id = crypto.randomUUID();
    this.groups.push({ id, name: name.trim().slice(0, 30) || "Dossier", collapsed: false, kind: "imported", persistent: true });
    this.notifyPolygonsChanged();
    return id;
  }

  /** Moves a polygon before `beforePolygonId` within `targetGroupId`. If `beforePolygonId` is null, appends to end of group. */
  reorderPolygon(polygonId: string, beforePolygonId: string | null, targetGroupId: string): void {
    const polyIndex = this.polygons.findIndex((p) => p.id === polygonId);
    if (polyIndex === -1) return;
    const targetGroup = this.groups.find((g) => g.id === targetGroupId);
    if (!targetGroup) return;
    const poly = this.polygons[polyIndex]!;
    const oldGroupId = poly.groupId;
    this.polygons.splice(polyIndex, 1);
    poly.groupId = targetGroupId;
    // Auto-cleanup non-persistent old group if now empty
    if (oldGroupId !== targetGroupId && !this.polygons.some((p) => p.groupId === oldGroupId)) {
      const oldGroup = this.groups.find((g) => g.id === oldGroupId);
      if (oldGroup && !oldGroup.persistent) {
        this.groups = this.groups.filter((g) => g.id !== oldGroupId);
      }
    }
    // Find insertion point
    if (beforePolygonId === null) {
      // Insert after the last polygon of the target group
      let insertAt = this.polygons.length;
      for (let i = this.polygons.length - 1; i >= 0; i--) {
        if (this.polygons[i]!.groupId === targetGroupId) { insertAt = i + 1; break; }
      }
      this.polygons.splice(insertAt, 0, poly);
    } else {
      const beforeIdx = this.polygons.findIndex((p) => p.id === beforePolygonId);
      this.polygons.splice(beforeIdx === -1 ? this.polygons.length : beforeIdx, 0, poly);
    }
    this.notifyPolygonsChanged();
  }

  renameGroup(id: string, name: string): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group || !name.trim()) return;
    group.name = name.trim();
    this.notifyPolygonsChanged();
  }

  deleteGroup(id: string): void {
    const toDelete = this.polygons.filter((p) => p.groupId === id);
    for (const poly of toDelete) {
      this.clearPolygonMapObjects(poly);
    }
    this.polygons = this.polygons.filter((p) => p.groupId !== id);
    this.groups = this.groups.filter((g) => g.id !== id);
    if (this.polygons.length === 0) {
      this.activeIndex = 0;
      this.onClosedChanged?.(false);
    } else {
      if (this.activeIndex >= this.polygons.length) this.activeIndex = this.polygons.length - 1;
      this.onClosedChanged?.(this.active?.isClosed ?? false);
    }
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  movePolygonToGroup(polygonId: string, groupId: string): void {
    // Delegate to reorderPolygon (appends to end of target group)
    this.reorderPolygon(polygonId, null, groupId);
  }

  toggleGroupCollapse(id: string): void {
    const group = this.groups.find((g) => g.id === id);
    if (!group) return;
    group.collapsed = !group.collapsed;
    this.notifyPolygonsChanged();
  }

  getGroups(): GroupInfo[] {
    return this.groups.map((g) => ({
      id: g.id,
      name: g.name,
      collapsed: g.collapsed,
      kind: g.kind,
      polygons: this.polygons
        .filter((p) => p.groupId === g.id)
        .map((p, _i) => {
          const globalIdx = this.polygons.indexOf(p);
          return {
            id: p.id,
            name: p.name,
            color: p.color,
            isClosed: p.isClosed,
            waypointCount: p.waypoints.length,
            isActive: globalIdx === this.activeIndex,
            isImported: p.kind === "imported",
            vertexCount: p.kind === "imported" ? p.rawCoordinates?.length : undefined,
            vertexEditActive: p.vertexEditActive ?? false,
            isSelected: this.selectedPolygonIds.has(p.id),
            canRestoreSimplify: !!p.preSimplifyCoordinates,
          };
        }),
    }));
  }

  getGroupPolygonsForExport(groupId: string): PolygonExportData[] {
    return this.polygons.filter((p) => p.groupId === groupId && p.isClosed).map((p) => this.buildExportData(p));
  }

  getAllPolygonsForExport(): PolygonExportData[] {
    return this.polygons.filter((p) => p.isClosed).map((p) => this.buildExportData(p));
  }

  getPolygonForExport(id: string): PolygonExportData | null {
    const poly = this.polygons.find((p) => p.id === id);
    if (!poly || !poly.isClosed) return null;
    return this.buildExportData(poly);
  }

  private buildExportData(poly: PolygonData): PolygonExportData {
    if (poly.kind === "imported" && poly.rawCoordinates) {
      return { name: poly.name, color: poly.color, segments: [], rawCoordinates: poly.rawCoordinates };
    }
    const segments = poly.waypoints.filter((w) => w.segment !== null).map((w) => w.segment!);
    if (poly.closingSegment) segments.push(poly.closingSegment);
    return { name: poly.name, color: poly.color, segments };
  }

  // ─── Import polygons from KML ──────────────────────────────────────────────

  importPolygons(polygons: { name: string; coordinates: { lat: number; lng: number }[] }[], groupName = "Import"): void {
    const groupId = this.createImportGroup(groupName);
    // All polygons from the same KML batch share one color
    const { color, textColor } = polygonColor(this.polygons.length);
    for (const parsed of polygons) {
      const path: [number, number][] = parsed.coordinates.map((c) => [c.lat, c.lng]);
      const id = crypto.randomUUID();
      const fillPolygon = this.makeFillPolygon(path, color);
      this.addFillClickHandler(fillPolygon, id);
      this.polygons.push({
        id,
        name: parsed.name,
        color,
        textColor,
        kind: "imported",
        groupId,
        waypoints: [],
        closingPolyline: null,
        closingSegment: null,
        fillPolygon,
        isClosed: true,
        rawCoordinates: parsed.coordinates,
      });
    }
    // Notify once after the full batch (not once per polygon)
    this.notifyPolygonsChanged();
  }

  // ─── Polygon simplification ───────────────────────────────────────────────

  private static readonly SIMPLIFY_BASE_EPSILON = 0.000005; // ≈ 0.55 m

  /** Apply one Douglas-Peucker pass to a single imported polygon.
   *  Epsilon doubles on each call so successive clicks progressively simplify. */
  simplifyPolygon(id: string): void {
    const poly = this.polygons.find(p => p.id === id);
    if (!poly || poly.kind !== "imported" || !poly.rawCoordinates || poly.rawCoordinates.length < 4) return;
    // Save original coords before the very first simplification pass
    if (!poly.preSimplifyCoordinates) poly.preSimplifyCoordinates = [...poly.rawCoordinates];
    const epsilon = poly.simplifyEpsilon
      ? poly.simplifyEpsilon * 2
      : MapController.SIMPLIFY_BASE_EPSILON;
    const simplified = douglasPeucker(poly.rawCoordinates, epsilon);
    if (simplified.length < 3) return;
    poly.rawCoordinates = simplified;
    poly.simplifyEpsilon = epsilon;
    if (poly.fillPolygon) this.updateFillPath(poly.fillPolygon, simplified.map(c => [c.lat, c.lng]));
    if (poly.vertexEditActive) this.rebuildVertexEdit(poly);
    this.notifyPolygonsChanged();
  }

  /** Restore the polygon to its pre-simplification coordinates. */
  restorePolygon(id: string): void {
    const poly = this.polygons.find(p => p.id === id);
    if (!poly || !poly.preSimplifyCoordinates) return;
    poly.rawCoordinates = poly.preSimplifyCoordinates;
    poly.preSimplifyCoordinates = undefined;
    poly.simplifyEpsilon = undefined;
    if (poly.fillPolygon) this.updateFillPath(poly.fillPolygon, poly.rawCoordinates.map(c => [c.lat, c.lng]));
    if (poly.vertexEditActive) this.rebuildVertexEdit(poly);
    this.notifyPolygonsChanged();
  }

  /** Apply one Douglas-Peucker pass to all imported polygons at once.
   *  Each polygon tracks its own epsilon and doubles it on each call. */
  simplifyAllPolygons(): void {
    for (const poly of this.polygons) {
      if (poly.kind !== "imported" || !poly.rawCoordinates || poly.rawCoordinates.length < 4) continue;
      const epsilon = poly.simplifyEpsilon
        ? poly.simplifyEpsilon * 2
        : MapController.SIMPLIFY_BASE_EPSILON;
      const simplified = douglasPeucker(poly.rawCoordinates, epsilon);
      if (simplified.length < 3) continue;
      poly.rawCoordinates = simplified;
      poly.simplifyEpsilon = epsilon;
      if (poly.fillPolygon) this.updateFillPath(poly.fillPolygon, simplified.map(c => [c.lat, c.lng]));
      if (poly.vertexEditActive) this.rebuildVertexEdit(poly);
    }
    this.notifyPolygonsChanged();
  }

  // ─── Vertex edit mode ─────────────────────────────────────────────────────

  toggleVertexEdit(id: string): void {
    const poly = this.polygons.find((p) => p.id === id);
    if (!poly || !poly.isClosed) return;
    if (poly.vertexEditActive) {
      this.deactivateVertexEdit(poly);
    } else {
      this.activateVertexEdit(poly);
    }
    this.notifyPolygonsChanged();
  }

  private activateVertexEdit(poly: PolygonData): void {
    if (poly.kind === "drawn") this.convertDrawnToFlat(poly);
    poly.vertexEditActive = true;
    this.rebuildVertexEdit(poly);
  }

  /** Converts a closed drawn polygon (waypoints + routing segments) to a flat
   *  rawCoordinates ring, enabling vertex edit. Irreversible. */
  private convertDrawnToFlat(poly: PolygonData): void {
    const coords = this.getPolygonFlatCoords(poly);
    for (const wp of poly.waypoints) {
      this.removeObj(wp.marker);
      this.removeObj(wp.polyline);
    }
    this.removeObj(poly.closingPolyline);
    poly.waypoints = [];
    poly.closingPolyline = null;
    poly.closingSegment = null;
    poly.rawCoordinates = coords;
    poly.kind = "imported";
    this.notifyChange();
  }

  private deactivateVertexEdit(poly: PolygonData): void {
    for (const vm of poly.vertexMarkers ?? []) this.removeObj(vm as L.CircleMarker);
    for (const ep of poly.edgePolylines ?? []) this.removeObj(ep);
    poly.vertexMarkers = [];
    poly.edgePolylines = [];
    poly.vertexEditActive = false;
  }

  private rebuildVertexEdit(poly: PolygonData): void {
    // Clean up previous markers/polylines without clearing vertexEditActive
    for (const vm of poly.vertexMarkers ?? []) this.removeObj(vm as L.CircleMarker);
    for (const ep of poly.edgePolylines ?? []) this.removeObj(ep);
    poly.vertexMarkers = [];
    poly.edgePolylines = [];

    const coords = poly.rawCoordinates;
    if (!coords || coords.length < 3) return;

    const n = coords.length;

    // ── Edge polylines (drawn first = below vertex markers in z-order) ──────
    // Thick white lines so they are clearly visible and easy to click.
    for (let i = 0; i < n; i++) {
      const a = coords[i]!;
      const b = coords[(i + 1) % n]!;
      const idx = i; // capture for closure

      if (!this.isOsm) {
        const polyline = new google.maps.Polyline({
          path: [{ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }],
          map: this.gMap!,
          strokeColor: "#ffffff",
          strokeWeight: 8,
          strokeOpacity: 0.55,
          zIndex: 10,
          clickable: true,
        });
        polyline.addListener("click", (e: google.maps.PolyMouseEvent) => {
          if (!e.latLng) return;
          coords.splice(idx + 1, 0, { lat: e.latLng.lat(), lng: e.latLng.lng() });
          this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
          this.rebuildVertexEdit(poly);
        });
        poly.edgePolylines!.push(polyline);
      } else {
        const polyline = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
          color: "#ffffff",
          weight: 10,
          opacity: 0.55,
          interactive: true,
        }).addTo(this.lMap!);
        polyline.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e); // prevent map click from firing
          coords.splice(idx + 1, 0, { lat: e.latlng.lat, lng: e.latlng.lng });
          this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
          this.rebuildVertexEdit(poly);
        });
        poly.edgePolylines!.push(polyline);
      }
    }

    // ── Vertex markers (drawn after = above edge polylines) ─────────────────
    for (let i = 0; i < n; i++) {
      const c = coords[i]!;
      let isDragging = false;

      if (!this.isOsm) {
        const marker = new google.maps.Marker({
          position: { lat: c.lat, lng: c.lng },
          map: this.gMap!,
          draggable: true,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 6,
            fillColor: "#ffffff",
            fillOpacity: 1,
            strokeColor: poly.color,
            strokeWeight: 2,
          },
          zIndex: 20,
          clickable: true,
        });

        marker.addListener("dragstart", () => { isDragging = true; });
        marker.addListener("dragend", (e: google.maps.MapMouseEvent) => {
          // Use setTimeout so the click event that fires right after dragend
          // still sees isDragging = true and does not delete the vertex.
          setTimeout(() => { isDragging = false; }, 0);
          if (e.latLng) {
            coords[i] = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
            this.rebuildVertexEdit(poly);
          }
        });
        marker.addListener("click", () => {
          if (isDragging) return;
          if (coords.length <= 3) return;
          coords.splice(i, 1);
          this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
          this.rebuildVertexEdit(poly);
        });

        poly.vertexMarkers!.push(marker);
      } else {
        const icon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid ${poly.color};box-sizing:border-box;cursor:grab;"></div>`,
          className: "",
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        });
        const marker = L.marker([c.lat, c.lng], { icon, draggable: true, zIndexOffset: 1000 }).addTo(this.lMap!);

        marker.on("dragstart", () => { isDragging = true; });
        marker.on("dragend", () => {
          // setTimeout so the click that Leaflet fires right after dragend
          // still sees isDragging = true and does not delete the vertex.
          const pos = marker.getLatLng();
          coords[i] = { lat: pos.lat, lng: pos.lng };
          this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
          this.rebuildVertexEdit(poly);
          setTimeout(() => { isDragging = false; }, 0);
        });
        marker.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stop(e); // prevent map click from propagating
          if (isDragging) return;
          if (coords.length <= 3) return;
          coords.splice(i, 1);
          this.updateFillPath(poly.fillPolygon!, coords.map((cc) => [cc.lat, cc.lng]));
          this.rebuildVertexEdit(poly);
        });

        poly.vertexMarkers!.push(marker as unknown as VertexMarker);
      }
    }
  }

  // ─── Snap / magnet tool ────────────────────────────────────────────────────

  setSnapMode(enabled: boolean): void {
    this.snapMode = enabled;
    if (enabled) {
      if (this.gMouseMoveListener || this.lMouseMoveHandler) return; // already enabled
      if (!this.isOsm && this.gMap) {
        this.gMouseMoveListener = this.gMap.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) this.handleMouseMove(e.latLng);
        });
      } else if (this.isOsm && this.lMap) {
        this.lMouseMoveHandler = (e: L.LeafletMouseEvent) => {
          this.handleMouseMove(new google.maps.LatLng(e.latlng.lat, e.latlng.lng));
        };
        this.lMap.on("mousemove", this.lMouseMoveHandler);
      }
    } else {
      if (this.gMouseMoveListener) { google.maps.event.removeListener(this.gMouseMoveListener); this.gMouseMoveListener = null; }
      if (this.lMouseMoveHandler && this.lMap) { this.lMap.off("mousemove", this.lMouseMoveHandler); this.lMouseMoveHandler = null; }
      this.removeObj(this.snapMarkerG); this.snapMarkerG = null;
      this.removeObj(this.snapMarkerL); this.snapMarkerL = null;
      this.snapTarget = null;
    }
  }

  private snapThresholdMeters(): number {
    const zoom = this.isOsm ? this.lMap!.getZoom() : (this.gMap!.getZoom() ?? 14);
    const lat = this.isOsm ? this.lMap!.getCenter().lat : this.gMap!.getCenter()!.lat();
    return ((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom)) * 20;
  }

  private handleMouseMove(mousePos: google.maps.LatLng): void {
    // Split mode: snap only to the active polygon's own contour
    if (this.splitState.active) {
      this.handleSplitMouseMove(mousePos);
      return;
    }

    const poly = this.active;
    if (poly.isClosed) {
      this.snapTarget = null;
      this.removeObj(this.snapMarkerG); this.snapMarkerG = null;
      this.removeObj(this.snapMarkerL); this.snapMarkerL = null;
      return;
    }

    const threshold = this.snapThresholdMeters();
    let closest: google.maps.LatLng | null = null;
    let closestDist = Infinity;

    for (const p of this.polygons) {
      if (p.id === poly.id || p.waypoints.length === 0) continue;
      for (const wp of p.waypoints) {
        const vertex = new google.maps.LatLng(wp.lat, wp.lng);
        const dist = google.maps.geometry.spherical.computeDistanceBetween(mousePos, vertex);
        if (dist < threshold && dist < closestDist) { closestDist = dist; closest = vertex; }
        if (wp.segment) {
          for (const pt of wp.segment.path) {
            const d = google.maps.geometry.spherical.computeDistanceBetween(mousePos, pt);
            if (d < threshold && d < closestDist) { closestDist = d; closest = pt; }
          }
        }
      }
      if (p.closingSegment) {
        for (const pt of p.closingSegment.path) {
          const d = google.maps.geometry.spherical.computeDistanceBetween(mousePos, pt);
          if (d < threshold && d < closestDist) { closestDist = d; closest = pt; }
        }
      }
    }

    this.updateSnapMarker(closest);
  }

  /** Snap scan used during split mode: targets the active polygon's own contour. */
  private handleSplitMouseMove(mousePos: google.maps.LatLng): void {
    const poly = this.active;
    const threshold = this.snapThresholdMeters();
    let closest: google.maps.LatLng | null = null;
    let closestDist = Infinity;

    const checkPt = (pt: google.maps.LatLng) => {
      const d = google.maps.geometry.spherical.computeDistanceBetween(mousePos, pt);
      if (d < threshold && d < closestDist) { closestDist = d; closest = pt; }
    };

    if (poly.kind === "imported" && poly.rawCoordinates) {
      for (const rc of poly.rawCoordinates) checkPt(new google.maps.LatLng(rc.lat, rc.lng));
    } else {
      for (const wp of poly.waypoints) {
        checkPt(new google.maps.LatLng(wp.lat, wp.lng));
        if (wp.segment) { for (const pt of wp.segment.path) checkPt(pt); }
      }
      if (poly.closingSegment) { for (const pt of poly.closingSegment.path) checkPt(pt); }
    }

    this.updateSnapMarker(closest);
  }

  private updateSnapMarker(closest: google.maps.LatLng | null): void {
    if (closest) {
      this.snapTarget = closest;
      const pos: [number, number] = [closest.lat(), closest.lng()];
      if (!this.isOsm) {
        if (!this.snapMarkerG) {
          this.snapMarkerG = new google.maps.Marker({ map: this.gMap!, position: { lat: pos[0], lng: pos[1] }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#fbbf24", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 }, clickable: false, zIndex: 20 });
        } else {
          this.snapMarkerG.setPosition({ lat: pos[0], lng: pos[1] });
          if (!this.snapMarkerG.getMap()) this.snapMarkerG.setMap(this.gMap);
        }
      } else {
        if (!this.snapMarkerL) {
          this.snapMarkerL = L.circleMarker(pos, { radius: 8, fillColor: "#fbbf24", fillOpacity: 1, color: "#ffffff", weight: 2, interactive: false }).addTo(this.lMap!);
        } else {
          this.snapMarkerL.setLatLng(pos);
        }
      }
    } else {
      this.snapTarget = null;
      this.removeObj(this.snapMarkerG); this.snapMarkerG = null;
      this.removeObj(this.snapMarkerL); this.snapMarkerL = null;
    }
  }

  // ─── Highlight inactive polygons ───────────────────────────────────────────

  private updateHighlights(): void {
    for (let i = 0; i < this.polygons.length; i++) {
      const poly = this.polygons[i]!;
      const isActive = i === this.activeIndex;
      const isSelected = this.selectedPolygonIds.has(poly.id);
      const strokeOp = isActive ? 1.0 : isSelected ? 0.7 : 0.35;
      const fillOp = isActive ? 0.25 : isSelected ? 0.15 : 0.07;
      this.setFillOpacity(poly.fillPolygon, fillOp);
      this.setFillStroke(poly.fillPolygon, isActive || isSelected ? 2 : 0, poly.color);
      for (const wp of poly.waypoints) {
        this.setPolylineOpacity(wp.polyline, strokeOp, wp.segment?.mode ?? "route", poly.color);
      }
      this.setPolylineOpacity(poly.closingPolyline, strokeOp, poly.closingSegment?.mode ?? "route", poly.color);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private clearPolygonMapObjects(poly: PolygonData): void {
    this.removeObj(poly.closingPolyline);
    this.removeObj(poly.fillPolygon);
    for (const wp of poly.waypoints) {
      this.removeObj(wp.marker);
      this.removeObj(wp.polyline);
    }
    for (const vm of poly.vertexMarkers ?? []) this.removeObj(vm as L.CircleMarker);
    for (const ep of poly.edgePolylines ?? []) this.removeObj(ep);
    poly.vertexMarkers = [];
    poly.edgePolylines = [];
    poly.vertexEditActive = false;
  }

  // ─── Travel mode ───────────────────────────────────────────────────────────

  setTravelMode(mode: google.maps.TravelMode): void { this.travelMode = mode; }
  getTravelMode(): google.maps.TravelMode { return this.travelMode; }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  getWaypoints(): Waypoint[] {
    if (this.polygons.length === 0) return [];
    return this.active.waypoints.map((w) => ({ lat: w.lat, lng: w.lng, label: w.label, segmentMode: w.segmentMode }));
  }

  getSegments(): ResolvedSegment[] {
    if (this.polygons.length === 0) return [];
    const poly = this.active;
    const segments = poly.waypoints.filter((w) => w.segment !== null).map((w) => w.segment!);
    if (poly.closingSegment) segments.push(poly.closingSegment);
    return segments;
  }

  getWaypointCount(): number { return this.polygons.length === 0 ? 0 : this.active.waypoints.length; }

  get closed(): boolean { return this.active?.isClosed ?? false; }

  // ─── Notify ────────────────────────────────────────────────────────────────

  private notifyChange(): void { this.onWaypointsChanged?.(this.getWaypoints(), this.getSegments()); }
  private notifyPolygonsChanged(): void { this.onPolygonsChanged?.(this.getGroups()); }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.gClickListener) { google.maps.event.removeListener(this.gClickListener); this.gClickListener = null; }
    if (this.gMouseMoveListener) { google.maps.event.removeListener(this.gMouseMoveListener); this.gMouseMoveListener = null; }
    if (this.lClickHandler && this.lMap) { this.lMap.off("click", this.lClickHandler); this.lClickHandler = null; }
    if (this.lMouseMoveHandler && this.lMap) { this.lMap.off("mousemove", this.lMouseMoveHandler); this.lMouseMoveHandler = null; }
    this.removeObj(this.snapMarkerG); this.snapMarkerG = null;
    this.removeObj(this.snapMarkerL); this.snapMarkerL = null;
    if (this.splitState.active) this.exitSplitMode();
    for (const poly of this.polygons) this.clearPolygonMapObjects(poly);
    this.polygons = [];
    this.lMap?.remove(); this.lMap = null;
    this.gMap = null;
  }

  // ─── Split / Merge helpers ─────────────────────────────────────────────────

  /** Extract a flat { lat, lng }[] from any polygon (imported or drawn). */
  private getPolygonFlatCoords(poly: PolygonData): { lat: number; lng: number }[] {
    if (poly.kind === "imported" && poly.rawCoordinates && poly.rawCoordinates.length > 0) {
      return poly.rawCoordinates;
    }
    const coords: { lat: number; lng: number }[] = [];
    for (const wp of poly.waypoints) {
      if (!wp.segment) {
        // First waypoint — no incoming segment yet
        coords.push({ lat: wp.lat, lng: wp.lng });
      } else {
        // wp.segment goes FROM the previous waypoint TO this one.
        // path[0] duplicates the previous position already in coords, so skip it.
        for (let i = 1; i < wp.segment.path.length; i++) {
          coords.push({ lat: wp.segment.path[i]!.lat(), lng: wp.segment.path[i]!.lng() });
        }
      }
    }
    if (poly.closingSegment) {
      // Closing segment: last waypoint → first waypoint. Skip path[0] (= last waypoint).
      for (let i = 1; i < poly.closingSegment.path.length; i++) {
        coords.push({ lat: poly.closingSegment.path[i]!.lat(), lng: poly.closingSegment.path[i]!.lng() });
      }
    }
    return coords;
  }

  private static haversineDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371000;
    const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
    const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
    const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
    const s = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }

  /** Project pt onto segment [a, b] using planar approximation (accurate for small distances). */
  private static projectPointOnSegment(
    pt: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number }
  ): { lat: number; lng: number } {
    const ax = b.lng - a.lng, ay = b.lat - a.lat;
    const bx = pt.lng - a.lng, by = pt.lat - a.lat;
    const t = Math.max(0, Math.min(1, (bx * ax + by * ay) / (ax * ax + ay * ay || 1)));
    return { lat: a.lat + t * ay, lng: a.lng + t * ax };
  }

  /** Move vertices of `source` that are within `toleranceMeters` onto the nearest edge of `reference`. */
  private static snapVerticesToEdges(
    source: { lat: number; lng: number }[],
    reference: { lat: number; lng: number }[],
    toleranceMeters: number
  ): { lat: number; lng: number }[] {
    return source.map(pt => {
      let nearest: { lat: number; lng: number } | null = null;
      let minDist = Infinity;
      for (let i = 0; i < reference.length; i++) {
        const a = reference[i]!;
        const b = reference[(i + 1) % reference.length]!;
        const proj = MapController.projectPointOnSegment(pt, a, b);
        const dist = MapController.haversineDistance(pt, proj);
        if (dist < toleranceMeters && dist < minDist) { minDist = dist; nearest = proj; }
      }
      return nearest ?? pt;
    });
  }

  /** Find the index in `contour` whose point is closest to `pt`. */
  private findContourIndex(pt: { lat: number; lng: number }, contour: { lat: number; lng: number }[]): number {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < contour.length; i++) {
      const d = MapController.haversineDistance(pt, contour[i]!);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  /** True if `pt` lies within `threshold` metres of any edge in `contour`. */
  private isPointOnContour(pt: { lat: number; lng: number }, contour: { lat: number; lng: number }[], threshold = 20): boolean {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]!, b = contour[(i + 1) % contour.length]!;
      const proj = MapController.projectPointOnSegment(pt, a, b);
      if (MapController.haversineDistance(pt, proj) < threshold) return true;
    }
    return false;
  }

  /** Flatten an array of ResolvedSegments into { lat, lng }[] (de-duped at joins). */
  private flattenSegments(segments: ResolvedSegment[]): { lat: number; lng: number }[] {
    const pts: { lat: number; lng: number }[] = [];
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s]!;
      const start = s === 0 ? 0 : 1; // skip duplicate join point
      for (let i = start; i < seg.path.length; i++) pts.push({ lat: seg.path[i]!.lat(), lng: seg.path[i]!.lng() });
    }
    return pts;
  }

  private serializePolygon(poly: PolygonData): SavedPolygonData {
    const group = this.groups.find(g => g.id === poly.groupId)!;
    return {
      id: poly.id,
      name: poly.name,
      color: poly.color,
      textColor: poly.textColor,
      groupId: poly.groupId,
      groupName: group?.name ?? "",
      groupKind: group?.kind ?? "drawn",
      groupPersistent: group?.persistent ?? false,
      rawCoordinates: this.getPolygonFlatCoords(poly),
    };
  }

  /** Create an imported polygon (no waypoints/markers) and add it to the map. Returns its id. */
  private addImportedPolygon(opts: {
    name: string;
    groupId: string;
    rawCoordinates: { lat: number; lng: number }[];
    id?: string;
    color?: string;
    textColor?: string;
  }): string {
    const currentForEdit = this.polygons[this.activeIndex];
    if (currentForEdit?.vertexEditActive) this.deactivateVertexEdit(currentForEdit);
    const [color, textColor] = opts.color
      ? [opts.color, opts.textColor ?? "#ffffff"]
      : POLYGON_PALETTE[this.polygons.length % POLYGON_PALETTE.length]!;

    const id = opts.id ?? crypto.randomUUID();
    const coords = opts.rawCoordinates;

    let fillPoly: AnyPolygon;
    if (!this.isOsm) {
      fillPoly = new google.maps.Polygon({
        paths: coords.map(c => ({ lat: c.lat, lng: c.lng })),
        map: this.gMap,
        fillColor: color,
        fillOpacity: 0.07,
        strokeColor: color,
        strokeOpacity: 0.35,
        strokeWeight: 0,
        clickable: true,
        zIndex: 1,
      });
    } else {
      fillPoly = L.polygon(coords.map(c => [c.lat, c.lng] as [number, number]), {
        color,
        fillColor: color,
        fillOpacity: 0.07,
        opacity: 0.35,
        weight: 0,
        interactive: true,
      }).addTo(this.lMap!);
    }

    const poly: PolygonData = {
      id,
      name: opts.name,
      color,
      textColor,
      kind: "imported",
      groupId: opts.groupId,
      waypoints: [],
      closingPolyline: null,
      closingSegment: null,
      fillPolygon: fillPoly,
      isClosed: true,
      rawCoordinates: coords,
    };

    this.addFillClickHandler(fillPoly, id);
    this.polygons.push(poly);
    this.selectedPolygonIds.add(id);

    // Make active
    this.activeIndex = this.polygons.length - 1;
    this.selectedPolygonIds.clear();
    this.selectedPolygonIds.add(id);
    this.updateHighlights();

    return id;
  }

  // ─── Merge ─────────────────────────────────────────────────────────────────

  async mergePolygons(id1: string, id2: string): Promise<void> {
    const p1 = this.polygons.find(p => p.id === id1);
    const p2 = this.polygons.find(p => p.id === id2);
    if (!p1 || !p2) return;

    const coords1 = this.getPolygonFlatCoords(p1);
    const coords2Raw = this.getPolygonFlatCoords(p2);
    const coords2 = MapController.snapVerticesToEdges(coords2Raw, coords1, MERGE_SNAP_DISTANCE_METERS);

    const toRing = (c: { lat: number; lng: number }[]) =>
      [...c.map(p => [p.lng, p.lat] as [number, number]), [c[0]!.lng, c[0]!.lat] as [number, number]];

    const f1 = turfPolygon([toRing(coords1)]);
    const f2 = turfPolygon([toRing(coords2)]);
    const result = turfUnion(featureCollection([f1, f2]));

    if (!result || result.geometry.type !== "Polygon") {
      this.onError?.("Ces deux polygones ne sont pas adjacents ou ne se chevauchent pas (tolérance : " + MERGE_SNAP_DISTANCE_METERS + " m).");
      return;
    }

    const undoOp: UndoOperation = {
      type: "merge",
      deletedPolygons: [this.serializePolygon(p1), this.serializePolygon(p2)],
      createdPolygonIds: [],
      groupsCreated: [],
    };

    const mergedCoords = (result.geometry.coordinates[0] as [number, number][]).map(([lng, lat]) => ({ lat, lng }));
    const mergedName = `${p1.name} - ${p2.name}`;
    const groupId = p1.groupId;
    const color = p1.color;
    const textColor = p1.textColor;

    this.deletePolygon(id1);
    this.deletePolygon(id2);

    const newId = this.addImportedPolygon({ name: mergedName, groupId, rawCoordinates: mergedCoords, color, textColor });
    undoOp.createdPolygonIds.push(newId);
    this.undoStack.push(undoOp);

    this.selectedPolygonIds.clear();
    this.selectedPolygonIds.add(newId);
    this.notifyPolygonsChanged();
  }

  // ─── Split mode ────────────────────────────────────────────────────────────

  enterSplitMode(): void {
    if (!this.active?.isClosed) return;
    this.splitState = {
      active: true,
      sourcePolygonId: this.active.id,
      startPoint: null,
      startContourIndex: -1,
      dividingSegments: [],
      dividingPolylines: [],
      startMarkerG: null,
      startMarkerL: null,
      snapWasActive: this.snapMode,
    };
    if (!this.snapMode) this.setSnapMode(true);
    const mapEl = this.isOsm ? this.lMap?.getContainer() : this.gMap?.getDiv();
    mapEl?.classList.add("map-split-mode");
    this.notifyPolygonsChanged();
  }

  exitSplitMode(): void {
    const mapEl = this.isOsm ? this.lMap?.getContainer() : this.gMap?.getDiv();
    mapEl?.classList.remove("map-split-mode");
    // Remove temporary dividing line polylines
    for (const pl of this.splitState.dividingPolylines) this.removeObj(pl);
    // Remove start marker
    if (this.splitState.startMarkerG) { this.splitState.startMarkerG.setMap(null); this.splitState.startMarkerG = null; }
    if (this.splitState.startMarkerL) { this.splitState.startMarkerL.remove(); this.splitState.startMarkerL = null; }

    const wasActive = this.splitState.snapWasActive;
    this.splitState = {
      active: false, sourcePolygonId: "", startPoint: null, startContourIndex: -1,
      dividingSegments: [], dividingPolylines: [], startMarkerG: null, startMarkerL: null, snapWasActive: false,
    };
    if (!wasActive) this.setSnapMode(false);
    this.notifyPolygonsChanged();
  }

  private placeStartMarker(pt: { lat: number; lng: number }): void {
    if (!this.isOsm) {
      this.splitState.startMarkerG = new google.maps.Marker({
        map: this.gMap,
        position: { lat: pt.lat, lng: pt.lng },
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#f87171", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
        clickable: false,
        zIndex: 25,
      });
    } else {
      this.splitState.startMarkerL = L.circleMarker([pt.lat, pt.lng], {
        radius: 9, fillColor: "#f87171", fillOpacity: 1, color: "#ffffff", weight: 2, interactive: false,
      }).addTo(this.lMap!);
    }
  }

  private drawTempPolyline(pts: { lat: number; lng: number }[]): void {
    if (pts.length < 2) return;
    if (!this.isOsm) {
      const pl = new google.maps.Polyline({
        path: pts.map(p => ({ lat: p.lat, lng: p.lng })),
        map: this.gMap,
        strokeColor: "#f87171",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        zIndex: 20,
      });
      this.splitState.dividingPolylines.push(pl);
    } else {
      const pl = L.polyline(pts.map(p => [p.lat, p.lng] as [number, number]), {
        color: "#f87171", opacity: 0.9, weight: 2, interactive: false,
      }).addTo(this.lMap!);
      this.splitState.dividingPolylines.push(pl);
    }
  }

  async handleSplitClick(rawLatLng: { lat(): number; lng(): number }): Promise<void> {
    const snapped = this.snapTarget ?? rawLatLng;
    this.snapTarget = null;

    const pt = { lat: snapped.lat(), lng: snapped.lng() };
    const contour = this.getPolygonFlatCoords(this.active);

    if (!this.splitState.startPoint) {
      // First click must be on the contour
      if (!this.isPointOnContour(pt, contour)) {
        this.onError?.("Cliquez sur le contour du polygone pour commencer la découpe.");
        return;
      }
      this.splitState.startPoint = pt;
      this.splitState.startContourIndex = this.findContourIndex(pt, contour);
      this.placeStartMarker(pt);
      return;
    }

    // Resolve segment from last waypoint to current point
    const prevPt = this.splitState.dividingSegments.length > 0
      ? (() => { const last = this.splitState.dividingSegments.at(-1)!; const lastPt = last.path.at(-1)!; return lastPt; })()
      : new google.maps.LatLng(this.splitState.startPoint.lat, this.splitState.startPoint.lng);

    const prevLatLng = prevPt instanceof google.maps.LatLng
      ? prevPt
      : new google.maps.LatLng((prevPt as { lat: number; lng: number }).lat, (prevPt as { lat: number; lng: number }).lng);

    const seg = await resolveSegment(
      { lat: prevLatLng.lat(), lng: prevLatLng.lng(), segmentMode: this.currentMode, label: "" },
      { lat: pt.lat, lng: pt.lng, segmentMode: this.currentMode, label: "" },
      this.travelMode
    );
    this.splitState.dividingSegments.push(seg);
    this.drawTempPolyline(seg.path.map(p => ({ lat: p.lat(), lng: p.lng() })));

    if (this.isPointOnContour(pt, contour)) {
      // End click on contour — execute split
      await this.executeSplit(pt);
    }
    // Otherwise: intermediate waypoint, continue
  }

  private async executeSplit(endPoint: { lat: number; lng: number }): Promise<void> {
    const sourcePoly = this.active;
    const contour = this.getPolygonFlatCoords(sourcePoly);
    const n = contour.length;
    const startIdx = this.splitState.startContourIndex;
    const endIdx = this.findContourIndex(endPoint, contour);

    if (startIdx === endIdx) {
      this.onError?.("Les points de début et de fin sont identiques. Sélectionnez deux points distincts sur le contour.");
      this.exitSplitMode();
      return;
    }

    // Arc 1: forward from startIdx to endIdx
    const arc1: { lat: number; lng: number }[] = [];
    for (let i = startIdx; i !== endIdx; i = (i + 1) % n) arc1.push(contour[i]!);
    arc1.push(contour[endIdx]!);

    // Arc 2: backward from startIdx to endIdx
    const arc2: { lat: number; lng: number }[] = [];
    for (let i = startIdx; i !== endIdx; i = (i - 1 + n) % n) arc2.push(contour[i]!);
    arc2.push(contour[endIdx]!);

    const dividingLine = this.flattenSegments(this.splitState.dividingSegments);

    // Poly1: arc1 + reversed dividing line
    const poly1Coords = [...arc1, ...[...dividingLine].reverse()];
    // Poly2: reversed arc2 + dividing line
    const poly2Coords = [...arc2.reverse(), ...dividingLine];

    const undoOp: UndoOperation = {
      type: "split",
      deletedPolygons: [this.serializePolygon(sourcePoly)],
      createdPolygonIds: [],
      groupsCreated: [],
    };

    const sourceName = sourcePoly.name;
    this.deletePolygon(sourcePoly.id);

    // Find or create "territoires enfants" group
    let childGroup = this.groups.find(g => g.name === "territoires enfants");
    if (!childGroup) {
      const gid = crypto.randomUUID();
      this.groups.push({ id: gid, name: "territoires enfants", collapsed: false, kind: "imported", persistent: true });
      childGroup = this.groups.find(g => g.id === gid)!;
      undoOp.groupsCreated.push(gid);
    }

    const id1 = this.addImportedPolygon({ name: `${sourceName}-1`, groupId: childGroup.id, rawCoordinates: poly1Coords });
    const id2 = this.addImportedPolygon({ name: `${sourceName}-2`, groupId: childGroup.id, rawCoordinates: poly2Coords });
    undoOp.createdPolygonIds.push(id1, id2);
    this.undoStack.push(undoOp);

    this.exitSplitMode();
    this.notifyPolygonsChanged();
  }

  // ─── Undo ─────────────────────────────────────────────────────────────────

  undoLastMergeSplit(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;

    for (const cid of op.createdPolygonIds) this.deletePolygon(cid);

    for (const saved of op.deletedPolygons) {
      // Ensure the group exists (re-create if needed)
      if (!this.groups.find(g => g.id === saved.groupId)) {
        this.groups.push({
          id: saved.groupId,
          name: saved.groupName,
          kind: saved.groupKind,
          collapsed: false,
          persistent: saved.groupPersistent,
        });
      }
      this.addImportedPolygon({
        id: saved.id,
        name: saved.name,
        groupId: saved.groupId,
        rawCoordinates: saved.rawCoordinates,
        color: saved.color,
        textColor: saved.textColor,
      });
    }

    // Remove groups created by the operation if now empty
    for (const gid of op.groupsCreated) {
      if (!this.polygons.some(p => p.groupId === gid)) {
        this.groups = this.groups.filter(g => g.id !== gid);
      }
    }

    this.selectedPolygonIds.clear();
    this.notifyPolygonsChanged();
    return true;
  }

  // ─── Map theme ─────────────────────────────────────────────────────────────

  setMapTheme(theme: "dark" | "light" | "satellite" | "terrain"): void {
    if (!this.isOsm && this.gMap) {
      switch (theme) {
        case "dark": this.gMap.setOptions({ styles: DARK_MAP_STYLES, mapTypeId: "roadmap" }); break;
        case "light": this.gMap.setOptions({ styles: [], mapTypeId: "roadmap" }); break;
        case "satellite": this.gMap.setOptions({ styles: [], mapTypeId: "satellite" }); break;
        case "terrain": this.gMap.setOptions({ styles: [], mapTypeId: "terrain" }); break;
      }
    } else if (this.isOsm && this.lMap && this.lTileLayer) {
      this.lTileLayer.remove();
      const { url, attribution } = TILE_LAYERS[theme];
      this.lTileLayer = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(this.lMap);
    }
  }
}

// ─── Dynamic Google Maps script loader ───────────────────────────────────────

let scriptLoadPromise: Promise<void> | null = null;

export function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (typeof google !== "undefined" && typeof google.maps !== "undefined") return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const callbackName = "__googleMapsInitCallback";

    (window as unknown as Record<string, unknown>)["gm_authFailure"] = () => {
      scriptLoadPromise = null;
      reject(new Error("Clé API invalide ou APIs non activées. Vérifie que Maps JavaScript API et Directions API sont activées dans Google Cloud Console."));
    };

    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      clearTimeout(timeout);
      resolve();
    };

    const timeout = setTimeout(() => {
      scriptLoadPromise = null;
      reject(new Error("Délai dépassé : Google Maps ne répond pas. Vérifie ta clé API et que les APIs sont activées dans Google Cloud Console."));
    }, 15_000);

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      clearTimeout(timeout);
      scriptLoadPromise = null;
      reject(new Error("Impossible de charger l'API Google Maps. Vérifie ta connexion internet et ta clé API."));
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}
