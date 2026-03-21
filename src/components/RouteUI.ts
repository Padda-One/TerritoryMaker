/**
 * RouteUI — orchestrates the full application lifecycle:
 *   - API key entry, encryption, restoration
 *   - Map initialization
 *   - Segment mode toggle
 *   - Transport mode selection
 *   - Waypoint list rendering
 *   - KML export panel
 *   - Error / loading feedback
 */

import * as ApiKeyManager from "./ApiKeyManager.ts";
import { MapController } from "./MapController.ts";
import { buildKml, downloadKml, copyKml, getStats } from "./KmlExporter.ts";
import type { Waypoint, ResolvedSegment, SegmentMode } from "./SegmentRouter.ts";

export class RouteUI {
  private mapController: MapController | null = null;
  private currentMode: SegmentMode = "route";
  private currentSegments: ResolvedSegment[] = [];
  private currentWaypoints: Waypoint[] = [];
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  // ─── Element accessors ───────────────────────────────────────────────────────

  private el<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found`);
    return el as T;
  }

  private elQ<T extends HTMLElement = HTMLElement>(
    selector: string,
    parent: HTMLElement | Document = document,
  ): T | null {
    return parent.querySelector<T>(selector);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    this.bindKeyPanel();
    this.bindTransportButtons();
    this.bindActionButtons();
    this.bindToggle();
    this.bindKmlButtons();

    // Try to restore a saved key
    try {
      const savedKey = await ApiKeyManager.loadKey();
      if (savedKey) {
        await this.initMap(savedKey);
        return;
      }
    } catch {
      // Ignore decryption errors — fall through to key entry
    }

    this.showPanel("key-panel");
  }

  // ─── Key panel ───────────────────────────────────────────────────────────────

  private bindKeyPanel(): void {
    const form = this.el("key-form");
    const input = this.el<HTMLInputElement>("key-input");
    const forgetBtn = this.el("btn-forget-key");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      await this.handleKeySubmit(key);
    });

    forgetBtn.addEventListener("click", () => {
      ApiKeyManager.forgetKey();
      this.mapController?.destroy();
      this.mapController = null;
      this.currentWaypoints = [];
      this.currentSegments = [];
      input.value = "";
      this.showPanel("key-panel");
    });
  }

  private async handleKeySubmit(key: string): Promise<void> {
    const submitBtn = this.elQ<HTMLButtonElement>("#key-form button[type=submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Chargement…";
    }

    try {
      await ApiKeyManager.saveKey(key);
      await this.initMap(key);
    } catch (err) {
      this.showError(
        err instanceof Error
          ? err.message
          : "Erreur lors du chargement de la carte.",
      );
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Charger la carte";
      }
    }
  }

  // ─── Map init ────────────────────────────────────────────────────────────────

  private async initMap(apiKey: string): Promise<void> {
    const mapEl = this.el("map");
    this.showPanel("map-panel");
    this.showMapLoading(true);

    try {
      this.mapController = new MapController();
      this.mapController.currentMode = this.currentMode;

      this.mapController.onWaypointsChanged = (waypoints, segments) => {
        this.currentWaypoints = waypoints;
        this.currentSegments = segments;
        this.renderWaypointList(waypoints);
        this.updateActionButtons();
        this.updateKmlPanel();
      };

      this.mapController.onError = (msg) => this.showError(msg);
      this.mapController.onLoadingChange = (loading) =>
        this.showMapLoading(loading);

      await this.mapController.init(apiKey, mapEl);
    } catch (err) {
      this.showPanel("key-panel");
      this.showError(
        err instanceof Error
          ? err.message
          : "Impossible de charger Google Maps.",
      );
      this.mapController = null;
    } finally {
      this.showMapLoading(false);
    }
  }

  // ─── Panel switching ─────────────────────────────────────────────────────────

  private showPanel(panelId: "key-panel" | "map-panel"): void {
    const keyPanel = this.el("key-panel");
    const mapPanel = this.el("map-panel");

    if (panelId === "key-panel") {
      keyPanel.classList.remove("hidden");
      mapPanel.classList.add("hidden");
    } else {
      keyPanel.classList.add("hidden");
      mapPanel.classList.remove("hidden");
    }
  }

  // ─── Segment mode toggle ─────────────────────────────────────────────────────

  private bindToggle(): void {
    const btnRoute = this.el("btn-mode-route");
    const btnStraight = this.el("btn-mode-straight");

    btnRoute.addEventListener("click", () => this.setMode("route"));
    btnStraight.addEventListener("click", () => this.setMode("straight"));

    this.renderToggle();
  }

  private setMode(mode: SegmentMode): void {
    this.currentMode = mode;
    if (this.mapController) {
      this.mapController.currentMode = mode;
    }
    this.renderToggle();
  }

  private renderToggle(): void {
    const btnRoute = this.el("btn-mode-route");
    const btnStraight = this.el("btn-mode-straight");

    if (this.currentMode === "route") {
      btnRoute.className = "toggle-pill-btn active-route";
      btnStraight.className = "toggle-pill-btn inactive";
    } else {
      btnRoute.className = "toggle-pill-btn inactive";
      btnStraight.className = "toggle-pill-btn active-straight";
    }
  }

  // ─── Transport buttons ───────────────────────────────────────────────────────

  private bindTransportButtons(): void {
    const buttons: Array<{ id: string; mode: string }> = [
      { id: "btn-transport-driving", mode: "DRIVING" },
      { id: "btn-transport-walking", mode: "WALKING" },
      { id: "btn-transport-bicycling", mode: "BICYCLING" },
    ];

    for (const { id, mode } of buttons) {
      const btn = document.getElementById(id);
      if (!btn) continue;
      btn.addEventListener("click", () => {
        if (!this.mapController) return;
        const travelMode =
          google.maps.TravelMode[mode as keyof typeof google.maps.TravelMode];
        this.mapController.setTravelMode(travelMode);
        this.renderTransportButtons(mode);
      });
    }
  }

  private renderTransportButtons(activeMode: string): void {
    const modes = ["DRIVING", "WALKING", "BICYCLING"];
    const ids: Record<string, string> = {
      DRIVING: "btn-transport-driving",
      WALKING: "btn-transport-walking",
      BICYCLING: "btn-transport-bicycling",
    };

    for (const mode of modes) {
      const btn = document.getElementById(ids[mode]!);
      if (!btn) continue;
      if (mode === activeMode) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  }

  // ─── Action buttons ──────────────────────────────────────────────────────────

  private bindActionButtons(): void {
    this.el("btn-undo").addEventListener("click", () => {
      this.mapController?.removeLastWaypoint();
    });

    this.el("btn-clear").addEventListener("click", () => {
      this.mapController?.clearAll();
    });
  }

  private updateActionButtons(): void {
    const count = this.currentWaypoints.length;
    this.el<HTMLButtonElement>("btn-undo").disabled = count === 0;
    this.el<HTMLButtonElement>("btn-clear").disabled = count === 0;
    this.el<HTMLButtonElement>("btn-export-kml").disabled = count < 3;
  }

  // ─── Waypoint list ───────────────────────────────────────────────────────────

  private renderWaypointList(waypoints: Waypoint[]): void {
    const list = this.el("waypoint-list");
    list.innerHTML = "";

    if (waypoints.length === 0) {
      list.innerHTML =
        '<p class="text-xs text-slate-500 italic py-2 text-center">Clique sur la carte pour ajouter des points</p>';
      return;
    }

    for (const wp of waypoints) {
      const item = document.createElement("div");
      item.className = "waypoint-item";

      const labelEl = document.createElement("span");
      labelEl.className = "waypoint-label";
      labelEl.style.color = wp.segmentMode === "route" ? "#00e5a0" : "#818cf8";
      labelEl.textContent = wp.label;

      const coordEl = document.createElement("span");
      coordEl.className = "text-xs text-slate-400 flex-1 truncate";
      coordEl.textContent = `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;

      item.appendChild(labelEl);
      item.appendChild(coordEl);

      // Badge (except first point which has no incoming segment)
      if (wp.label !== "A") {
        const badge = document.createElement("span");
        badge.className =
          wp.segmentMode === "route"
            ? "segment-badge segment-badge-route"
            : "segment-badge segment-badge-straight";
        badge.textContent = wp.segmentMode === "route" ? "🛣" : "✈";
        item.appendChild(badge);
      }

      list.appendChild(item);
    }
  }

  // ─── KML export panel ────────────────────────────────────────────────────────

  private bindKmlButtons(): void {
    const exportBtn = this.el("btn-export-kml");
    const panel = this.el("kml-panel");

    exportBtn.addEventListener("click", () => {
      panel.classList.toggle("hidden");
      if (!panel.classList.contains("hidden")) {
        this.updateKmlPanel();
      }
    });

    this.el("btn-kml-copy").addEventListener("click", async () => {
      const kml = this.getCurrentKml();
      if (!kml) return;
      try {
        await copyKml(kml);
        this.flashButton("btn-kml-copy", "✓ Copié !");
      } catch {
        this.showError("Impossible de copier dans le presse-papiers.");
      }
    });

    this.el("btn-kml-download").addEventListener("click", () => {
      const kml = this.getCurrentKml();
      if (!kml) return;
      downloadKml(kml);
    });

    this.el("btn-kml-close").addEventListener("click", () => {
      panel.classList.add("hidden");
    });
  }

  private getCurrentKml(): string | null {
    if (this.currentSegments.length === 0) return null;
    return buildKml(this.currentSegments, this.currentWaypoints);
  }

  private updateKmlPanel(): void {
    const panel = this.el("kml-panel");
    if (panel.classList.contains("hidden")) return;

    const kml = this.getCurrentKml();
    if (!kml) {
      panel.classList.add("hidden");
      return;
    }

    const textarea = this.el<HTMLTextAreaElement>("kml-output");
    textarea.value = kml;

    const stats = getStats(this.currentSegments);
    this.el("kml-stats").innerHTML =
      `<span class="text-slate-400">Points : </span><span class="text-white font-semibold">${stats.totalPoints}</span>` +
      ` &nbsp;·&nbsp; <span class="text-slate-400">Segments route : </span><span style="color:#00e5a0" class="font-semibold">${stats.routeCount}</span>` +
      ` &nbsp;·&nbsp; <span class="text-slate-400">Vol d'oiseau : </span><span style="color:#818cf8" class="font-semibold">${stats.straightCount}</span>`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private showMapLoading(visible: boolean): void {
    const overlay = document.getElementById("map-loading");
    if (!overlay) return;
    if (visible) {
      overlay.classList.remove("hidden");
    } else {
      overlay.classList.add("hidden");
    }
  }

  private showError(message: string): void {
    // Remove existing toast
    const existing = document.getElementById("error-toast");
    if (existing) existing.remove();
    if (this.errorTimer) clearTimeout(this.errorTimer);

    const toast = document.createElement("div");
    toast.id = "error-toast";
    toast.className = "error-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    this.errorTimer = setTimeout(() => {
      toast.remove();
      this.errorTimer = null;
    }, 6000);
  }

  private flashButton(id: string, text: string): void {
    const btn = document.getElementById(id);
    if (!btn) return;
    const original = btn.textContent ?? "";
    btn.textContent = text;
    setTimeout(() => {
      btn.textContent = original;
    }, 1800);
  }
}
