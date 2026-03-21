/**
 * MapController — manages the Google Maps instance, markers, polylines, and
 * the canonical waypoints array. Handles dynamic Maps JS API loading.
 * Supports multiple polygons with layer management and snap/magnet tool.
 */

import { resolveSegment, RoutingError } from "./SegmentRouter.ts";
import type { SegmentMode, Waypoint, ResolvedSegment } from "./SegmentRouter.ts";

export type { SegmentMode, Waypoint, ResolvedSegment };

// ─── Internal types ───────────────────────────────────────────────────────────

interface WaypointInternal extends Waypoint {
  marker: google.maps.Marker;
  segment: ResolvedSegment | null; // null for the first point (no incoming seg)
  polyline: google.maps.Polyline | null;
}

interface PolygonData {
  id: string;
  name: string;
  color: string;
  textColor: string;
  waypoints: WaypointInternal[];
  closingPolyline: google.maps.Polyline | null;
  closingSegment: ResolvedSegment | null;
  fillPolygon: google.maps.Polygon | null;
  isClosed: boolean;
}

export interface PolygonInfo {
  id: string;
  name: string;
  color: string;
  isClosed: boolean;
  waypointCount: number;
  isActive: boolean;
}

export interface PolygonExportData {
  name: string;
  color: string;
  segments: ResolvedSegment[];
}

// ─── Color palette ────────────────────────────────────────────────────────────

const POLYGON_PALETTE: Array<[string, string]> = [
  ["#00e5a0", "#0f1117"], // green  — dark text
  ["#4a90d9", "#ffffff"], // blue   — white text
  ["#f5a623", "#0f1117"], // orange — dark text
  ["#e74c3c", "#ffffff"], // red    — white text
  ["#9b59b6", "#ffffff"], // purple — white text
  ["#f1c40f", "#0f1117"], // yellow — dark text
];

function polygonColor(index: number): { color: string; textColor: string } {
  const pair = POLYGON_PALETTE[index % POLYGON_PALETTE.length]!;
  return { color: pair[0], textColor: pair[1] };
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

function routePolylineOptions(color: string, opacity = 1): google.maps.PolylineOptions {
  return { strokeColor: color, strokeWeight: 3, strokeOpacity: opacity, zIndex: 2 };
}

function straightPolylineOptions(color: string, opacity = 1): google.maps.PolylineOptions {
  return {
    strokeColor: color,
    strokeWeight: 2,
    strokeOpacity: 0,
    zIndex: 1,
    icons: [
      {
        icon: {
          path: "M 0,-1 0,1",
          strokeOpacity: opacity,
          strokeColor: color,
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

function createMarkerIcon(
  label: string,
  color: string,
  textColor: string,
): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40">
    <path d="M16 0C7.163 0 0 7.163 0 16c0 10.59 14.374 23.05 15.015 23.596a1.5 1.5 0 0 0 1.97 0C17.626 39.05 32 26.59 32 16 32 7.163 24.837 0 16 0z" fill="${color}"/>
    <text x="16" y="20" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="700" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(32, 40),
    anchor: new google.maps.Point(16, 40),
  };
}

/** Marker icon for edit (drag) mode — larger, with yellow outer ring. */
function createMarkerIconEdit(
  label: string,
  color: string,
  textColor: string,
): google.maps.Icon {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
    <path d="M19 0C9.059 0 1 8.059 1 18c0 11.912 16.17 25.938 17.092 26.748a1.5 1.5 0 0 0 1.816 0C20.83 43.938 37 29.912 37 18 37 8.059 28.941 0 19 0z" fill="#fbbf24"/>
    <path d="M19 3.5C11.268 3.5 5 9.768 5 17.5c0 9.548 12.374 21.15 13.015 21.746a1.5 1.5 0 0 0 1.97 0C20.626 38.65 33 27.048 33 17.5 33 9.768 26.732 3.5 19 3.5z" fill="${color}"/>
    <text x="19" y="21" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" font-weight="700" fill="${textColor}" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(38, 46),
    anchor: new google.maps.Point(19, 46),
  };
}

// ─── MapController ────────────────────────────────────────────────────────────

export class MapController {
  private map: google.maps.Map | null = null;
  private polygons: PolygonData[] = [];
  private activeIndex = 0;
  private travelMode = "DRIVING" as google.maps.TravelMode;
  private clickListener: google.maps.MapsEventListener | null = null;

  // Snap / magnet tool
  private snapMarker: google.maps.Marker | null = null;
  private snapTarget: google.maps.LatLng | null = null;
  private mouseMoveListener: google.maps.MapsEventListener | null = null;

  // Callbacks wired up by RouteUI
  public onWaypointsChanged: ((waypoints: Waypoint[], segments: ResolvedSegment[]) => void) | null = null;
  public onPolygonsChanged: ((polygons: PolygonInfo[]) => void) | null = null;
  public onError: ((message: string) => void) | null = null;
  public onLoadingChange: ((loading: boolean) => void) | null = null;
  public onClosedChanged: ((closed: boolean) => void) | null = null;

  // ─── Map initialisation ────────────────────────────────────────────────────

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
        if (e.latLng) this.handleMapClick(e.latLng);
      },
    );
  }

  // ─── Active polygon accessor ───────────────────────────────────────────────

  private get active(): PolygonData {
    return this.polygons[this.activeIndex]!;
  }

  /** The RouteUI sets this before each click so MapController knows the mode. */
  public currentMode: SegmentMode = "route";

  // ─── Click handler ─────────────────────────────────────────────────────────

  private async handleMapClick(rawLatLng: google.maps.LatLng): Promise<void> {
    const poly = this.active;
    if (poly.isClosed) return;

    // Use snapped position if available, then clear it
    const latLng = this.snapTarget ?? rawLatLng;
    this.snapTarget = null;

    const label = String.fromCharCode(65 + poly.waypoints.length); // A, B, C…
    const waypoint: Waypoint = {
      lat: latLng.lat(),
      lng: latLng.lng(),
      label,
      segmentMode: this.currentMode,
    };

    await this.addWaypoint(waypoint);
  }

  // ─── Add waypoint ──────────────────────────────────────────────────────────

  async addWaypoint(waypoint: Waypoint): Promise<void> {
    const poly = this.active;
    if (!this.map || poly.isClosed) return;

    const isFirst = poly.waypoints.length === 0;
    const marker = new google.maps.Marker({
      position: { lat: waypoint.lat, lng: waypoint.lng },
      map: this.map,
      icon: createMarkerIcon(waypoint.label, poly.color, poly.textColor),
      zIndex: 10,
    });

    // Make the first marker clickable to close the polygon.
    // Use a 250 ms debounce so a double-click can cancel the close and enter
    // edit mode instead (dblclick fires two click events before dblclick).
    if (isFirst) {
      let pendingClose: ReturnType<typeof setTimeout> | null = null;

      marker.addListener("click", () => {
        if (poly.waypoints.length >= 3 && !poly.isClosed) {
          pendingClose = setTimeout(() => {
            pendingClose = null;
            this.closePolygon().catch((err) => {
              this.onError?.(err instanceof Error ? err.message : "Erreur lors de la fermeture du polygone.");
            });
          }, 250);
        }
      });

      // dblclick cancels the pending close so edit mode can take over
      marker.addListener("dblclick", () => {
        if (pendingClose) {
          clearTimeout(pendingClose);
          pendingClose = null;
        }
      });
    }

    let segment: ResolvedSegment | null = null;
    let polyline: google.maps.Polyline | null = null;

    if (!isFirst) {
      const prev = poly.waypoints[poly.waypoints.length - 1]!;
      const prevWaypoint: Waypoint = {
        lat: prev.lat,
        lng: prev.lng,
        label: prev.label,
        segmentMode: prev.segmentMode,
      };

      this.onLoadingChange?.(true);
      try {
        segment = await resolveSegment(prevWaypoint, waypoint, this.travelMode);
        polyline = this.drawSegment(segment, poly.color);
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

    poly.waypoints.push({ ...waypoint, marker, segment, polyline });
    this.setupMarkerDragEdit(poly, poly.waypoints.length - 1);
    this.notifyChange();
  }

  // ─── Marker drag-edit ──────────────────────────────────────────────────────

  /**
   * Wires double-click → drag-to-move on an existing waypoint marker.
   * Double-clicking enters edit mode (yellow ring icon, draggable).
   * Releasing the drag recalculates adjacent segments and rebuilds the fill.
   */
  private setupMarkerDragEdit(poly: PolygonData, wpIndex: number): void {
    const wp = poly.waypoints[wpIndex]!;
    let editing = false;

    wp.marker.addListener("dblclick", () => {
      if (editing) return;
      editing = true;
      wp.marker.setDraggable(true);
      wp.marker.setIcon(createMarkerIconEdit(wp.label, poly.color, poly.textColor));
    });

    wp.marker.addListener("dragend", async (e: google.maps.MapMouseEvent) => {
      if (!editing || !e.latLng) return;
      editing = false;
      wp.marker.setDraggable(false);
      wp.marker.setIcon(createMarkerIcon(wp.label, poly.color, poly.textColor));

      wp.lat = e.latLng.lat();
      wp.lng = e.latLng.lng();

      this.onLoadingChange?.(true);
      try {
        await this.recalcAdjacentSegments(poly, wpIndex);
      } catch (err) {
        this.onError?.(err instanceof Error ? err.message : "Erreur lors de la mise à jour du point.");
      } finally {
        this.onLoadingChange?.(false);
      }

      this.notifyChange();
      this.notifyPolygonsChanged();
    });
  }

  // ─── Recalculate segments around a moved waypoint ─────────────────────────

  private async recalcAdjacentSegments(poly: PolygonData, wpIndex: number): Promise<void> {
    const wp = poly.waypoints[wpIndex]!;
    const thisWp: Waypoint = { lat: wp.lat, lng: wp.lng, label: wp.label, segmentMode: wp.segmentMode };

    // Incoming segment: from wp[i-1] → wp[i]
    if (wpIndex > 0) {
      const prev = poly.waypoints[wpIndex - 1]!;
      const prevWp: Waypoint = { lat: prev.lat, lng: prev.lng, label: prev.label, segmentMode: prev.segmentMode };
      wp.polyline?.setMap(null);
      const seg = await resolveSegment(prevWp, thisWp, this.travelMode);
      wp.segment = seg;
      wp.polyline = this.drawSegment(seg, poly.color);
    }

    // Outgoing segment: from wp[i] → wp[i+1]
    if (wpIndex < poly.waypoints.length - 1) {
      const next = poly.waypoints[wpIndex + 1]!;
      const nextWp: Waypoint = { lat: next.lat, lng: next.lng, label: next.label, segmentMode: next.segmentMode };
      next.polyline?.setMap(null);
      const seg = await resolveSegment(thisWp, nextWp, this.travelMode);
      next.segment = seg;
      next.polyline = this.drawSegment(seg, poly.color);
    }

    // Closing segment: recalc if this is the first or last point of a closed polygon
    if (poly.isClosed && (wpIndex === 0 || wpIndex === poly.waypoints.length - 1)) {
      const first = poly.waypoints[0]!;
      const last = poly.waypoints[poly.waypoints.length - 1]!;
      const closingFrom: Waypoint = { lat: last.lat, lng: last.lng, label: last.label, segmentMode: last.segmentMode };
      const closingTo: Waypoint = { lat: first.lat, lng: first.lng, label: first.label, segmentMode: poly.closingSegment?.mode ?? "route" };
      poly.closingPolyline?.setMap(null);
      const seg = await resolveSegment(closingFrom, closingTo, this.travelMode);
      poly.closingPolyline = this.drawSegment(seg, poly.color);
      poly.closingSegment = seg;
    }

    // Rebuild fill overlay if polygon is closed
    if (poly.isClosed) {
      this.rebuildFillPolygon(poly);
    }
  }

  // ─── Rebuild fill polygon after waypoint move ──────────────────────────────

  private rebuildFillPolygon(poly: PolygonData): void {
    if (!this.map || !poly.closingSegment) return;

    const path: google.maps.LatLng[] = [];
    for (let i = 0; i < poly.waypoints.length; i++) {
      const wp = poly.waypoints[i]!;
      if (wp.segment) {
        const start = path.length === 0 ? 0 : 1;
        for (let j = start; j < wp.segment.path.length; j++) path.push(wp.segment.path[j]!);
      } else {
        path.push(new google.maps.LatLng(wp.lat, wp.lng));
      }
    }
    for (let j = 1; j < poly.closingSegment.path.length; j++) path.push(poly.closingSegment.path[j]!);

    if (poly.fillPolygon) {
      poly.fillPolygon.setPaths([path]);
    } else {
      poly.fillPolygon = new google.maps.Polygon({
        paths: path,
        map: this.map,
        fillColor: poly.color,
        fillOpacity: 0.15,
        strokeWeight: 0,
        zIndex: 0,
      });
    }
  }

  // ─── Polygon closure ───────────────────────────────────────────────────────

  private async closePolygon(): Promise<void> {
    const poly = this.active;
    if (!this.map || poly.waypoints.length < 3) return;

    const first = poly.waypoints[0]!;
    const last = poly.waypoints[poly.waypoints.length - 1]!;

    const closingFrom: Waypoint = { lat: last.lat, lng: last.lng, label: last.label, segmentMode: last.segmentMode };
    const closingTo: Waypoint = { lat: first.lat, lng: first.lng, label: first.label, segmentMode: this.currentMode };

    this.onLoadingChange?.(true);
    try {
      const segment = await resolveSegment(closingFrom, closingTo, this.travelMode);
      poly.closingPolyline = this.drawSegment(segment, poly.color);
      poly.closingSegment = segment;

      // Build the full polygon path from all segments + closing segment
      const path: google.maps.LatLng[] = [];
      for (let i = 0; i < poly.waypoints.length; i++) {
        const wp = poly.waypoints[i]!;
        if (wp.segment) {
          const start = path.length === 0 ? 0 : 1;
          for (let j = start; j < wp.segment.path.length; j++) path.push(wp.segment.path[j]!);
        } else {
          path.push(new google.maps.LatLng(wp.lat, wp.lng));
        }
      }
      for (let j = 1; j < segment.path.length; j++) path.push(segment.path[j]!);

      poly.fillPolygon = new google.maps.Polygon({
        paths: path,
        map: this.map,
        fillColor: poly.color,
        fillOpacity: 0.15,
        strokeWeight: 0,
        zIndex: 0,
      });

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
    poly.closingPolyline?.setMap(null);
    poly.closingPolyline = null;
    poly.closingSegment = null;
    poly.fillPolygon?.setMap(null);
    poly.fillPolygon = null;
    poly.isClosed = false;
    this.onClosedChanged?.(false);
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  // ─── Draw polyline ─────────────────────────────────────────────────────────

  private drawSegment(segment: ResolvedSegment, color: string): google.maps.Polyline {
    const options =
      segment.mode === "route"
        ? routePolylineOptions(color)
        : straightPolylineOptions(color);

    return new google.maps.Polyline({
      path: segment.path,
      map: this.map!,
      ...options,
    });
  }

  // ─── Remove last waypoint ──────────────────────────────────────────────────

  removeLastWaypoint(): void {
    const poly = this.active;
    if (poly.isClosed) {
      this.openPolygon();
      return;
    }

    const last = poly.waypoints.pop();
    if (!last) return;

    last.marker.setMap(null);
    last.polyline?.setMap(null);

    this.notifyChange();
  }

  // ─── Clear active polygon ──────────────────────────────────────────────────

  clearAll(): void {
    const poly = this.active;
    this.clearPolygonMapObjects(poly);
    const wasClosed = poly.isClosed;
    poly.closingPolyline = null;
    poly.closingSegment = null;
    poly.fillPolygon = null;
    poly.isClosed = false;
    poly.waypoints = [];
    if (wasClosed) this.onClosedChanged?.(false);
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  // ─── Polygon management ────────────────────────────────────────────────────

  addPolygon(): string {
    const index = this.polygons.length;
    const { color, textColor } = polygonColor(index);
    const id = crypto.randomUUID();
    const poly: PolygonData = {
      id,
      name: `Polygone ${index + 1}`,
      color,
      textColor,
      waypoints: [],
      closingPolyline: null,
      closingSegment: null,
      fillPolygon: null,
      isClosed: false,
    };
    this.polygons.push(poly);
    this.activeIndex = this.polygons.length - 1;
    this.notifyChange();
    this.notifyPolygonsChanged();
    return id;
  }

  setActivePolygon(id: string): void {
    const idx = this.polygons.findIndex((p) => p.id === id);
    if (idx === -1 || idx === this.activeIndex) return;
    this.activeIndex = idx;
    this.updateHighlights();
    this.onClosedChanged?.(this.active.isClosed);
    this.notifyChange();
    this.notifyPolygonsChanged();
  }

  deletePolygon(id: string): void {
    const idx = this.polygons.findIndex((p) => p.id === id);
    if (idx === -1) return;

    this.clearPolygonMapObjects(this.polygons[idx]!);
    this.polygons.splice(idx, 1);

    if (this.polygons.length === 0) {
      // Always keep at least one polygon — re-create a fresh one
      const { color, textColor } = polygonColor(0);
      this.polygons.push({
        id: crypto.randomUUID(),
        name: "Polygone 1",
        color,
        textColor,
        waypoints: [],
        closingPolyline: null,
        closingSegment: null,
        fillPolygon: null,
        isClosed: false,
      });
      this.activeIndex = 0;
    } else {
      if (this.activeIndex >= this.polygons.length) {
        this.activeIndex = this.polygons.length - 1;
      }
    }

    this.onClosedChanged?.(this.active.isClosed);
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
    }));
  }

  getAllPolygonsForExport(): PolygonExportData[] {
    return this.polygons
      .filter((p) => p.isClosed)
      .map((p) => {
        const segments = p.waypoints
          .filter((w) => w.segment !== null)
          .map((w) => w.segment!);
        if (p.closingSegment) segments.push(p.closingSegment);
        return { name: p.name, color: p.color, segments };
      });
  }

  // ─── Snap / magnet tool ────────────────────────────────────────────────────

  setSnapMode(enabled: boolean): void {
    if (enabled && this.map) {
      this.mouseMoveListener = this.map.addListener(
        "mousemove",
        (e: google.maps.MapMouseEvent) => {
          if (e.latLng) this.handleMouseMove(e.latLng);
        },
      );
    } else {
      if (this.mouseMoveListener) {
        google.maps.event.removeListener(this.mouseMoveListener);
        this.mouseMoveListener = null;
      }
      this.snapMarker?.setMap(null);
      this.snapMarker = null;
      this.snapTarget = null;
    }
  }

  private snapThresholdMeters(): number {
    const zoom = this.map!.getZoom() ?? 14;
    const lat = this.map!.getCenter()!.lat();
    const metersPerPixel =
      (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    return metersPerPixel * 20; // 20px snap radius
  }

  private handleMouseMove(mousePos: google.maps.LatLng): void {
    const poly = this.active;
    if (poly.isClosed) {
      // No more points can be added to a closed polygon
      this.snapTarget = null;
      this.snapMarker?.setMap(null);
      return;
    }

    const threshold = this.snapThresholdMeters();
    let closest: google.maps.LatLng | null = null;
    let closestDist = Infinity;

    for (const p of this.polygons) {
      if (p.id === poly.id || p.waypoints.length === 0) continue;

      // Check waypoint vertices
      for (const wp of p.waypoints) {
        const vertex = new google.maps.LatLng(wp.lat, wp.lng);
        const dist = google.maps.geometry.spherical.computeDistanceBetween(mousePos, vertex);
        if (dist < threshold && dist < closestDist) {
          closestDist = dist;
          closest = vertex;
        }

        // Check intermediate segment path points
        if (wp.segment) {
          for (const pt of wp.segment.path) {
            const d = google.maps.geometry.spherical.computeDistanceBetween(mousePos, pt);
            if (d < threshold && d < closestDist) {
              closestDist = d;
              closest = pt;
            }
          }
        }
      }

      // Check closing segment path points
      if (p.closingSegment) {
        for (const pt of p.closingSegment.path) {
          const d = google.maps.geometry.spherical.computeDistanceBetween(mousePos, pt);
          if (d < threshold && d < closestDist) {
            closestDist = d;
            closest = pt;
          }
        }
      }
    }

    if (closest) {
      this.snapTarget = closest;
      if (!this.snapMarker) {
        this.snapMarker = new google.maps.Marker({
          map: this.map!,
          position: closest,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: "#fbbf24",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          clickable: false,
          zIndex: 20,
        });
      } else {
        this.snapMarker.setPosition(closest);
        if (!this.snapMarker.getMap()) this.snapMarker.setMap(this.map);
      }
    } else {
      this.snapTarget = null;
      this.snapMarker?.setMap(null);
    }
  }

  // ─── Highlight inactive polygons ───────────────────────────────────────────

  private updateHighlights(): void {
    for (let i = 0; i < this.polygons.length; i++) {
      const poly = this.polygons[i]!;
      const isActive = i === this.activeIndex;
      const strokeOp = isActive ? 1.0 : 0.35;
      const fillOp = isActive ? 0.15 : 0.06;

      poly.fillPolygon?.setOptions({ fillOpacity: fillOp });

      for (const wp of poly.waypoints) {
        if (!wp.polyline || !wp.segment) continue;
        if (wp.segment.mode === "route") {
          wp.polyline.setOptions({ strokeOpacity: strokeOp });
        } else {
          wp.polyline.setOptions({
            icons: [{
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: strokeOp,
                strokeColor: poly.color,
                strokeWeight: 2,
                scale: 3,
              },
              offset: "0",
              repeat: "10px",
            }],
          });
        }
      }

      if (poly.closingPolyline && poly.closingSegment) {
        if (poly.closingSegment.mode === "route") {
          poly.closingPolyline.setOptions({ strokeOpacity: strokeOp });
        } else {
          poly.closingPolyline.setOptions({
            icons: [{
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: strokeOp,
                strokeColor: poly.color,
                strokeWeight: 2,
                scale: 3,
              },
              offset: "0",
              repeat: "10px",
            }],
          });
        }
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private clearPolygonMapObjects(poly: PolygonData): void {
    poly.closingPolyline?.setMap(null);
    poly.fillPolygon?.setMap(null);
    for (const wp of poly.waypoints) {
      wp.marker.setMap(null);
      wp.polyline?.setMap(null);
    }
  }

  // ─── Travel mode ───────────────────────────────────────────────────────────

  setTravelMode(mode: google.maps.TravelMode): void {
    this.travelMode = mode;
  }

  getTravelMode(): google.maps.TravelMode {
    return this.travelMode;
  }

  // ─── Accessors ─────────────────────────────────────────────────────────────

  getWaypoints(): Waypoint[] {
    return this.active.waypoints.map((w) => ({
      lat: w.lat,
      lng: w.lng,
      label: w.label,
      segmentMode: w.segmentMode,
    }));
  }

  getSegments(): ResolvedSegment[] {
    const poly = this.active;
    const segments = poly.waypoints
      .filter((w) => w.segment !== null)
      .map((w) => w.segment!);
    if (poly.closingSegment) segments.push(poly.closingSegment);
    return segments;
  }

  getWaypointCount(): number {
    return this.active.waypoints.length;
  }

  get closed(): boolean {
    return this.active?.isClosed ?? false;
  }

  // ─── Notify ────────────────────────────────────────────────────────────────

  private notifyChange(): void {
    this.onWaypointsChanged?.(this.getWaypoints(), this.getSegments());
  }

  private notifyPolygonsChanged(): void {
    this.onPolygonsChanged?.(this.getPolygons());
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.clickListener) {
      google.maps.event.removeListener(this.clickListener);
      this.clickListener = null;
    }
    if (this.mouseMoveListener) {
      google.maps.event.removeListener(this.mouseMoveListener);
      this.mouseMoveListener = null;
    }
    this.snapMarker?.setMap(null);
    this.snapMarker = null;

    for (const poly of this.polygons) {
      this.clearPolygonMapObjects(poly);
    }
    this.polygons = [];
    this.map = null;
  }

  // ─── Map theme ─────────────────────────────────────────────────────────────

  setMapTheme(theme: "dark" | "light" | "satellite" | "terrain"): void {
    if (!this.map) return;
    switch (theme) {
      case "dark":
        this.map.setOptions({ styles: DARK_MAP_STYLES, mapTypeId: "roadmap" });
        break;
      case "light":
        this.map.setOptions({ styles: [], mapTypeId: "roadmap" });
        break;
      case "satellite":
        this.map.setOptions({ styles: [], mapTypeId: "satellite" });
        break;
      case "terrain":
        this.map.setOptions({ styles: [], mapTypeId: "terrain" });
        break;
    }
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

    // Auth failure: invalid key, billing not enabled, or APIs not activated
    (window as unknown as Record<string, unknown>)["gm_authFailure"] = () => {
      console.error("[Maps] gm_authFailure triggered");
      scriptLoadPromise = null;
      reject(new Error("Clé API invalide ou APIs non activées. Vérifie que Maps JavaScript API et Directions API sont activées dans Google Cloud Console."));
    };

    (window as unknown as Record<string, unknown>)[callbackName] = () => {
      console.log("[Maps] callback triggered — API loaded");
      clearTimeout(timeout);
      resolve();
    };

    // Timeout: if callback never fires after 15s, surface the error
    const timeout = setTimeout(() => {
      console.error("[Maps] timeout — callback never fired");
      scriptLoadPromise = null;
      reject(new Error("Délai dépassé : Google Maps ne répond pas. Vérifie ta clé API et que les APIs sont activées dans Google Cloud Console."));
    }, 15_000);

    const script = document.createElement("script");
    console.log("[Maps] injecting script tag");
    // Note: do NOT use loading=async with the callback approach — it prevents the callback from firing
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geometry&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onload = () => console.log("[Maps] script onload fired");
    script.onerror = () => {
      clearTimeout(timeout);
      scriptLoadPromise = null;
      reject(new Error("Impossible de charger l'API Google Maps. Vérifie ta connexion internet et ta clé API."));
    };

    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}
