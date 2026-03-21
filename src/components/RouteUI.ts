/**
 * RouteUI — orchestrates the full application lifecycle:
 *   - Settings panel (API key + appearance)
 *   - Map initialization
 *   - Segment mode toggle
 *   - Transport mode selection
 *   - Waypoint list rendering
 *   - KML export panel
 *   - Error / loading feedback
 *   - App theme & map theme management
 */

import * as ApiKeyManager from "./ApiKeyManager.ts";
import { MapController } from "./MapController.ts";
import { buildKml, downloadKml, copyKml, getStats } from "./KmlExporter.ts";
import type { Waypoint, ResolvedSegment, SegmentMode } from "./SegmentRouter.ts";

type MapTheme = "dark" | "light" | "satellite" | "terrain";
type AppTheme = "dark" | "light" | "system";

export class RouteUI {
  private mapController: MapController | null = null;
  private currentMode: SegmentMode = "route";
  private currentSegments: ResolvedSegment[] = [];
  private currentWaypoints: Waypoint[] = [];
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private isMapLoaded = false;

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
    this.initThemes();
    this.bindSettings();
    this.bindTransportButtons();
    this.bindActionButtons();
    this.bindToggle();
    this.bindKmlButtons();

    // Try to restore a saved key
    const savedKey = await ApiKeyManager.loadKey().catch(() => null);
    if (savedKey) {
      this.updateKeySection(true);
      await this.initMap(savedKey);
      return;
    }

    this.updateKeySection(false);
    this.showSettingsPanel();
  }

  // ─── Settings panel ──────────────────────────────────────────────────────────

  private bindSettings(): void {
    // Key form submit
    const form = this.el("key-form");
    const input = this.el<HTMLInputElement>("key-input");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      await this.handleKeySubmit(key);
    });

    // Forget key
    this.el("btn-forget-key").addEventListener("click", () => {
      ApiKeyManager.forgetKey();
      this.mapController?.destroy();
      this.mapController = null;
      this.isMapLoaded = false;
      this.currentWaypoints = [];
      this.currentSegments = [];
      this.el<HTMLInputElement>("key-input").value = "";
      this.updateKeySection(false);
      this.showSettingsPanel();
    });

    // Settings toggle
    this.el("btn-settings-toggle").addEventListener("click", () => {
      const settingsVisible = this.el("settings-panel").style.display !== "none";
      if (settingsVisible && this.isMapLoaded) {
        this.showMapPanel();
      } else if (!settingsVisible) {
        this.showSettingsPanel();
      }
      // If settings visible but no map → do nothing (can't close without a loaded map)
    });
  }

  private updateKeySection(hasKey: boolean): void {
    const formSection = document.getElementById("key-form-section");
    const storedSection = document.getElementById("key-stored-section");
    if (formSection) formSection.style.display = hasKey ? "none" : "flex";
    if (storedSection) storedSection.style.display = hasKey ? "flex" : "none";
  }

  private showSettingsPanel(): void {
    this.el("settings-panel").style.display = "flex";
    this.el("map-panel").style.display = "none";
    this.el("btn-settings-toggle").classList.add("active");
  }

  private showMapPanel(): void {
    this.el("settings-panel").style.display = "none";
    this.el("map-panel").style.display = "flex";
    this.el("btn-settings-toggle").classList.remove("active");
  }

  // ─── Themes ──────────────────────────────────────────────────────────────────

  private initThemes(): void {
    const savedAppTheme = (localStorage.getItem("tm_app_theme") ?? "dark") as AppTheme;
    const savedMapTheme = (localStorage.getItem("tm_map_theme") ?? "dark") as MapTheme;

    this.applyAppTheme(savedAppTheme);
    this.setActiveThemeBtn("app-theme-picker", savedAppTheme);
    this.setActiveThemeBtn("map-theme-picker", savedMapTheme);

    // App theme picker
    document.getElementById("app-theme-picker")
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const theme = (btn.dataset.value ?? "dark") as AppTheme;
          this.applyAppTheme(theme);
          localStorage.setItem("tm_app_theme", theme);
          this.setActiveThemeBtn("app-theme-picker", theme);
        });
      });

    // Map theme picker
    document.getElementById("map-theme-picker")
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const theme = (btn.dataset.value ?? "dark") as MapTheme;
          localStorage.setItem("tm_map_theme", theme);
          this.setActiveThemeBtn("map-theme-picker", theme);
          this.mapController?.setMapTheme(theme);
        });
      });
  }

  private applyAppTheme(theme: AppTheme): void {
    const html = document.documentElement;
    if (theme === "system") {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      html.setAttribute("data-theme", prefersDark ? "dark" : "light");
    } else {
      html.setAttribute("data-theme", theme);
    }
  }

  private setActiveThemeBtn(pickerId: string, value: string): void {
    document.getElementById(pickerId)
      ?.querySelectorAll<HTMLButtonElement>(".theme-btn")
      .forEach((btn) => btn.classList.toggle("active", btn.dataset.value === value));
  }

  // ─── Key submit ──────────────────────────────────────────────────────────────

  private async handleKeySubmit(key: string): Promise<void> {
    const submitBtn = this.elQ<HTMLButtonElement>("#key-form button[type=submit]");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Chargement…";
    }

    try {
      await ApiKeyManager.saveKey(key);
      this.updateKeySection(true);
      await this.initMap(key);
    } catch (err) {
      this.updateKeySection(false);
      this.showError(
        err instanceof Error ? err.message : "Erreur lors du chargement de la carte.",
      );
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Charger la carte";
      }
    }
  }

  // ─── Map init ────────────────────────────────────────────────────────────────

  private async initMap(apiKey: string): Promise<void> {
    const mapEl = this.el("map");
    this.showMapPanel();
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
      this.mapController.onLoadingChange = (loading) => this.showMapLoading(loading);
      this.mapController.onClosedChanged = (closed) => this.handleClosedChanged(closed);

      await this.mapController.init(apiKey, mapEl);

      // Apply saved map theme
      const savedMapTheme = (localStorage.getItem("tm_map_theme") ?? "dark") as MapTheme;
      if (savedMapTheme !== "dark") {
        this.mapController.setMapTheme(savedMapTheme);
      }

      this.isMapLoaded = true;
    } catch (err) {
      this.isMapLoaded = false;
      this.updateKeySection(false);
      this.showSettingsPanel();
      this.showError(
        err instanceof Error ? err.message : "Impossible de charger Google Maps.",
      );
      this.mapController = null;
    } finally {
      this.showMapLoading(false);
    }
  }

  // ─── Segment mode toggle ─────────────────────────────────────────────────────

  private bindToggle(): void {
    this.el("btn-mode-route").addEventListener("click", () => this.setMode("route"));
    this.el("btn-mode-straight").addEventListener("click", () => this.setMode("straight"));
    this.renderToggle();
  }

  private setMode(mode: SegmentMode): void {
    this.currentMode = mode;
    if (this.mapController) this.mapController.currentMode = mode;
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
      document.getElementById(id)?.addEventListener("click", () => {
        if (!this.mapController) return;
        const travelMode =
          google.maps.TravelMode[mode as keyof typeof google.maps.TravelMode];
        this.mapController.setTravelMode(travelMode);
        this.renderTransportButtons(mode);
      });
    }
  }

  private renderTransportButtons(activeMode: string): void {
    const ids: Record<string, string> = {
      DRIVING: "btn-transport-driving",
      WALKING: "btn-transport-walking",
      BICYCLING: "btn-transport-bicycling",
    };
    for (const [mode, id] of Object.entries(ids)) {
      document.getElementById(id)?.classList.toggle("active", mode === activeMode);
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
    const closed = this.mapController?.closed ?? false;
    const undoBtn = this.el<HTMLButtonElement>("btn-undo");
    undoBtn.disabled = count === 0;
    undoBtn.textContent = closed ? "↩ Rouvrir le polygone" : "↩ Supprimer dernier";
    this.el<HTMLButtonElement>("btn-clear").disabled = count === 0;
    this.el<HTMLButtonElement>("btn-export-kml").disabled = count < 3;

    const hint = document.getElementById("map-hint-text");
    if (hint && !closed) {
      hint.textContent = count >= 3
        ? "Clique sur le point A pour fermer le polygone"
        : "Clique sur la carte pour placer un point de passage";
    }
  }

  private handleClosedChanged(closed: boolean): void {
    const hint = document.getElementById("map-hint-text");
    if (hint) {
      hint.textContent = closed
        ? "Polygone fermé — clique sur ↩ Rouvrir pour modifier"
        : this.currentWaypoints.length >= 3
          ? "Clique sur le point A pour fermer le polygone"
          : "Clique sur la carte pour placer un point de passage";
    }
    this.updateActionButtons();
  }

  // ─── Waypoint list ───────────────────────────────────────────────────────────

  private renderWaypointList(waypoints: Waypoint[]): void {
    const list = this.el("waypoint-list");
    list.replaceChildren();

    if (waypoints.length === 0) {
      const empty = document.createElement("p");
      empty.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);font-style:italic;text-align:center;padding:8px 0;margin:0;";
      empty.textContent = "Clique sur la carte pour ajouter des points";
      list.appendChild(empty);
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
      coordEl.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
      coordEl.textContent = `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}`;

      item.appendChild(labelEl);
      item.appendChild(coordEl);

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
      const isVisible = panel.style.display !== "none";
      panel.style.display = isVisible ? "none" : "flex";
      if (!isVisible) this.updateKmlPanel();
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
      if (kml) downloadKml(kml);
    });

    this.el("btn-kml-close").addEventListener("click", () => {
      panel.style.display = "none";
    });
  }

  private getCurrentKml(): string | null {
    if (this.currentSegments.length === 0) return null;
    return buildKml(this.currentSegments, this.currentWaypoints);
  }

  private updateKmlPanel(): void {
    const panel = this.el("kml-panel");
    if (panel.style.display === "none") return;

    const kml = this.getCurrentKml();
    if (!kml) {
      panel.style.display = "none";
      return;
    }

    this.el<HTMLTextAreaElement>("kml-output").value = kml;

    const stats = getStats(this.currentSegments);
    const statsEl = this.el("kml-stats");
    statsEl.replaceChildren();

    const addStat = (label: string, value: string, color?: string) => {
      const span = document.createElement("span");
      span.style.color = "var(--color-text-muted)";
      span.textContent = label;
      statsEl.appendChild(span);
      const val = document.createElement("strong");
      if (color) val.style.color = color;
      val.textContent = value;
      statsEl.appendChild(val);
    };

    addStat("Points : ", String(stats.totalPoints));
    statsEl.appendChild(document.createTextNode(" · "));
    addStat("Route : ", String(stats.routeCount), "#00e5a0");
    statsEl.appendChild(document.createTextNode(" · "));
    addStat("Ligne droite : ", String(stats.straightCount), "#818cf8");
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private showMapLoading(visible: boolean): void {
    const overlay = document.getElementById("map-loading");
    if (!overlay) return;
    overlay.style.display = visible ? "flex" : "none";
  }

  private showError(message: string): void {
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
    setTimeout(() => { btn.textContent = original; }, 1800);
  }
}
