/**
 * RouteUI — orchestrates the full application lifecycle:
 *   - Settings panel (API key + appearance)
 *   - Map initialization
 *   - Segment mode toggle
 *   - Transport mode selection
 *   - Waypoint list rendering
 *   - Layer panel (multi-polygon management)
 *   - Snap / magnet tool
 *   - KML export panel
 *   - Error / loading feedback
 *   - App theme & map theme management
 */

import * as ApiKeyManager from "./ApiKeyManager.ts";
import { MapController } from "./MapController.ts";
import { buildKmlMulti, downloadKml, copyKml, getStats } from "./KmlExporter.ts";
import { parseKmlFile } from "./KmlImporter.ts";
import type { Waypoint, ResolvedSegment, SegmentMode } from "./SegmentRouter.ts";
import type { GroupInfo, MapProvider } from "./MapController.ts";

type MapTheme = "dark" | "light" | "satellite" | "terrain";
type AppTheme = "dark" | "light" | "system";

export class RouteUI {
  private mapController: MapController | null = null;
  private currentMode: SegmentMode = "route";
  private currentSegments: ResolvedSegment[] = [];
  private currentWaypoints: Waypoint[] = [];
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private isMapLoaded = false;
  private snapActive = false;

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
    this.bindKmlImport();
    this.bindSnapToggle();
    this.bindProviderToggle();
    this.bindSidebarResize();
    this.bindContextMenu();

    // Try to restore a saved key — validate before hiding the landing
    const savedKey = await ApiKeyManager.loadKey().catch(() => null);
    if (savedKey) {
      this.updateKeySection(true);
      try {
        await this.exitLanding(savedKey);
      } catch (err) {
        // Saved key is invalid — clear it, rebind form first (clones DOM), then show error
        ApiKeyManager.forgetKey();
        this.updateKeySection(false);
        this.bindLandingForm(); // replaces #landing-error node — must run before touching it
        const errorEl = document.getElementById("landing-error");
        if (errorEl) {
          errorEl.textContent = err instanceof Error ? err.message : "Clé API invalide.";
          errorEl.hidden = false;
        }
      }
      return;
    }

    // No key — show landing form (landing overlay is already visible)
    this.bindLandingForm();
    this.updateKeySection(false);
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
      this.showLandingAfterForget();
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

  // ─── Landing page ─────────────────────────────────────────────────────────────

  /** Hides the landing overlay immediately (key was already stored). */
  private hideLanding(): void {
    const el = document.getElementById("landing-page");
    if (el) el.style.display = "none";
  }

  /** Animates the landing out, then initialises the map. */
  private async exitLanding(key: string): Promise<void> {
    // rethrow=true: errors surface to the caller (form handler or init startup)
    await this.initMap(key, undefined, true);
    const landing = document.getElementById("landing-page");
    if (landing) {
      landing.classList.add("landing--exit");
      await new Promise<void>((r) => setTimeout(r, 400));
      landing.style.display = "none";
    }
    document.body.classList.add("app--fadein");
  }

  /** Resets and shows the landing after the user forgets their key. */
  private showLandingAfterForget(): void {
    const landing = document.getElementById("landing-page");
    if (!landing) return;
    landing.classList.remove("landing--exit");
    landing.style.display = "";
    landing.style.opacity = "";
    landing.style.transform = "";
    document.body.classList.remove("app--fadein");
    const input = document.getElementById("landing-key-input") as HTMLInputElement | null;
    if (input) input.value = "";
    const errorEl = document.getElementById("landing-error") as HTMLElement | null;
    if (errorEl) errorEl.hidden = true;
    const btn = landing.querySelector<HTMLButtonElement>("button[type=submit]");
    if (btn) { btn.disabled = false; btn.textContent = "Lancer Territory Maker →"; }
    this.bindLandingForm();
  }

  /** Binds the landing page key form submit handler. */
  private bindLandingForm(): void {
    const form = document.getElementById("landing-key-form");
    if (!form) return;
    // Remove any previous listener by cloning the form node
    const fresh = form.cloneNode(true) as HTMLFormElement;
    form.replaceWith(fresh);

    fresh.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("landing-key-input") as HTMLInputElement;
      const errorEl = document.getElementById("landing-error") as HTMLElement;
      const btn = fresh.querySelector<HTMLButtonElement>("button[type=submit]")!;
      const key = input.value.trim();
      if (!key) return;

      btn.disabled = true;
      btn.textContent = "Chargement…";
      errorEl.hidden = true;

      try {
        await ApiKeyManager.saveKey(key);
        this.updateKeySection(true);
        await this.exitLanding(key);
      } catch (err) {
        errorEl.textContent = err instanceof Error
          ? err.message
          : "Erreur lors du chargement de la carte.";
        errorEl.hidden = false;
        btn.disabled = false;
        btn.textContent = "Initialiser la session";
      }
    });
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

  private async initMap(
    apiKey: string,
    initialView?: { center: { lat: number; lng: number }; zoom: number },
    rethrow = false,
  ): Promise<void> {
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

      this.mapController.onPolygonsChanged = (groups) => {
        this.renderLayerPanel(groups);
        this.updateSplitMergeButtons(groups);
      };

      this.mapController.onError = (msg) => this.showError(msg);
      this.mapController.onLoadingChange = (loading) => this.showMapLoading(loading);
      this.mapController.onClosedChanged = (closed) => this.handleClosedChanged(closed);

      const provider = (localStorage.getItem("tm_map_provider") ?? "google") as MapProvider;
      await this.mapController.init(apiKey, mapEl, provider, initialView);

      // Apply saved map theme
      const savedMapTheme = (localStorage.getItem("tm_map_theme") ?? "dark") as MapTheme;
      if (savedMapTheme !== "dark") {
        this.mapController.setMapTheme(savedMapTheme);
      }

      this.isMapLoaded = true;
      this.bindLayerPanel();
      const initialGroups = this.mapController?.getGroups() ?? [];
      this.renderLayerPanel(initialGroups);
      this.updateSplitMergeButtons(initialGroups);
      this.updateActionButtons();
    } catch (err) {
      this.isMapLoaded = false;
      this.mapController = null;
      this.showMapLoading(false);
      if (rethrow) throw err;
      this.updateKeySection(false);
      this.showSettingsPanel();
      this.showError(err instanceof Error ? err.message : "Impossible de charger Google Maps.");
      return;
    }
    this.showMapLoading(false);
  }

  private async switchProvider(): Promise<void> {
    const viewState = this.mapController?.getViewState() ?? undefined;
    this.mapController?.destroy();
    this.mapController = null;
    this.isMapLoaded = false;
    this.currentWaypoints = [];
    this.currentSegments = [];
    const apiKey = await ApiKeyManager.loadKey().catch(() => null);
    if (apiKey) await this.initMap(apiKey, viewState);
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

    document.addEventListener("keydown", (e) => {
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        // Try merge/split undo first; fall back to waypoint undo
        const undone = this.mapController?.undoLastMergeSplit();
        if (!undone) this.mapController?.removeLastWaypoint();
      }
    });
    this.el("btn-clear").addEventListener("click", () => {
      this.mapController?.clearAll();
    });

    document.getElementById("btn-vertex-edit")?.addEventListener("click", () => {
      const active = this.mapController?.getPolygons().find((p) => p.isActive);
      if (active) this.mapController?.toggleVertexEdit(active.id);
    });

    document.getElementById("btn-split")?.addEventListener("click", () => {
      if (this.mapController?.splitModeActive) {
        this.mapController.exitSplitMode();
      } else {
        this.mapController?.enterSplitMode();
      }
    });

    document.getElementById("btn-merge")?.addEventListener("click", () => {
      const ids = this.mapController?.getSelectedPolygonIds() ?? [];
      if (ids.length === 2) {
        void this.mapController?.mergePolygons(ids[0]!, ids[1]!);
      }
    });

    document.getElementById("btn-undo-split-merge")?.addEventListener("click", () => {
      this.mapController?.undoLastMergeSplit();
    });
  }

  private updateSplitMergeButtons(groups: GroupInfo[]): void {
    const allPolygons = groups.flatMap(g => g.polygons);
    const active = allPolygons.find(p => p.isActive);
    const selectedCount = this.mapController?.getSelectedPolygonIds().length ?? 0;
    const splitModeActive = this.mapController?.splitModeActive ?? false;
    const undoStackSize = this.mapController?.getUndoStackSize() ?? 0;

    const btnSplit = document.getElementById("btn-split") as HTMLButtonElement | null;
    const btnMerge = document.getElementById("btn-merge") as HTMLButtonElement | null;
    const btnUndoSM = document.getElementById("btn-undo-split-merge") as HTMLButtonElement | null;

    if (btnSplit) {
      const canSplit = active?.isClosed && !splitModeActive && selectedCount <= 1;
      const inSplitMode = splitModeActive;
      btnSplit.style.display = (canSplit || inSplitMode) ? "" : "none";
      btnSplit.textContent = inSplitMode
        ? (this.mapController?.splitStartSet ? "✂ En cours…" : "✂ Annuler")
        : "✂";
      btnSplit.title = inSplitMode ? "Annuler la découpe" : "Découper le polygone";
      btnSplit.classList.toggle("active-snap", inSplitMode);
    }

    if (btnMerge) {
      btnMerge.style.display = selectedCount === 2 ? "" : "none";
    }

    if (btnUndoSM) {
      btnUndoSM.style.display = undoStackSize > 0 ? "" : "none";
    }
  }

  private updateVertexEditButton(groups: GroupInfo[]): void {
    const allPolygons = groups.flatMap((g) => g.polygons);
    const active = allPolygons.find((p) => p.isActive);
    const btn = document.getElementById("btn-vertex-edit") as HTMLButtonElement | null;
    if (!btn) return;
    btn.style.display = active?.isImported ? "" : "none";
    if (active?.vertexEditActive) {
      btn.textContent = "⊗";
    } else {
      const img = document.createElement("img");
      img.src = "/images/tools/pencil.svg";
      img.width = 20;
      img.height = 20;
      img.setAttribute("aria-hidden", "true");
      btn.replaceChildren(img);
    }
    btn.title = active?.vertexEditActive
      ? "Quitter l'édition des coordonnées"
      : "Éditer les coordonnées du polygone importé";
    btn.classList.toggle("active-snap", active?.vertexEditActive ?? false);
  }

  private updateActionButtons(): void {
    const count = this.currentWaypoints.length;
    const closed = this.mapController?.closed ?? false;
    const undoBtn = this.el<HTMLButtonElement>("btn-undo");
    undoBtn.disabled = count === 0;
    undoBtn.textContent = closed ? "↩ Rouvrir le polygone" : "↩ Supprimer dernier";
    this.el<HTMLButtonElement>("btn-clear").disabled = count === 0;
    this.el<HTMLButtonElement>("btn-export-kml").disabled =
      (this.mapController?.getAllPolygonsForExport().length ?? 0) === 0;
    this.updateVertexEditButton(this.mapController?.getGroups() ?? []);

    // Enable "New polygon" button when there are no polygons, or when the active polygon is closed
    const polygonsCount = this.mapController?.getGroups().flatMap((g) => g.polygons).length ?? 0;
    const addBtn = document.getElementById("btn-add-polygon") as HTMLButtonElement | null;
    if (addBtn) addBtn.disabled = polygonsCount > 0 && !closed;

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

  // ─── Layer panel ─────────────────────────────────────────────────────────────

  private bindLayerPanel(): void {
    document.getElementById("btn-add-polygon")?.addEventListener("click", () => {
      this.mapController?.addPolygon();
    });

    document.getElementById("layer-filter")?.addEventListener("input", () => {
      requestAnimationFrame(() => {
        const groups = this.mapController?.getGroups() ?? [];
        this.renderLayerPanel(groups);
      });
    });
  }

  // ─── Sidebar resize ──────────────────────────────────────────────────────────

  private bindSidebarResize(): void {
    const sidebar = document.getElementById("sidebar");
    const handle = document.getElementById("sidebar-resize");
    if (!sidebar || !handle) return;

    // Restore saved width
    const saved = localStorage.getItem("tm_sidebar_width");
    if (saved) sidebar.style.width = `${Math.max(180, Math.min(600, Number(saved)))}px`;

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      document.body.classList.add("sidebar-resizing");
      const startX = e.clientX;
      const startW = sidebar.offsetWidth;

      const onMove = (mv: MouseEvent) => {
        const w = Math.max(180, Math.min(600, startW + mv.clientX - startX));
        sidebar.style.width = `${w}px`;
      };
      const onUp = () => {
        handle.classList.remove("dragging");
        document.body.classList.remove("sidebar-resizing");
        localStorage.setItem("tm_sidebar_width", String(sidebar.offsetWidth));
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ─── Context menu ─────────────────────────────────────────────────────────────

  private bindContextMenu(): void {
    const list = document.getElementById("polygon-layer-list");
    const menu = document.getElementById("layer-ctx-menu");
    if (!list || !menu) return;
    menu.setAttribute("role", "menu");

    const hideMenu = () => { menu.hidden = true; menu.replaceChildren(); };

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target as Node)) hideMenu();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideMenu(); });

    list.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      hideMenu();

      const target = e.target as HTMLElement;
      const groupRow = target.closest<HTMLElement>(".group-row");
      const polyRow = target.closest<HTMLElement>(".polygon-layer-row");
      const groupChildrenEl = polyRow?.closest<HTMLElement>(".group-children");
      const groupId = groupRow?.dataset.groupId ?? groupChildrenEl?.dataset.parentGroup;
      const polyId = polyRow?.dataset.id;

      const mkItem = (icon: string, label: string, danger = false): HTMLDivElement => {
        const el = document.createElement("div");
        el.className = "ctx-item" + (danger ? " danger" : "");
        el.setAttribute("role", "menuitem");
        const iconSpan = document.createElement("span");
        iconSpan.setAttribute("aria-hidden", "true");
        iconSpan.textContent = icon;
        el.appendChild(iconSpan);
        el.appendChild(document.createTextNode(" " + label));
        return el;
      };

      const mkSep = (): HTMLDivElement => {
        const el = document.createElement("div");
        el.className = "ctx-separator";
        return el;
      };

      const mkNewFolder = (): HTMLDivElement => {
        const it = mkItem("📁", "Nouveau dossier");
        it.addEventListener("click", () => {
          hideMenu();
          const name = prompt("Nom du nouveau dossier :", "Nouveau dossier");
          if (name?.trim()) this.mapController?.addGroup(name.trim());
        });
        return it;
      };

      if (polyRow && polyId) {
        const groups = this.mapController?.getGroups() ?? [];
        const otherGroups = groups.filter((g) => g.id !== groupId);
        if (otherGroups.length > 0) {
          const header = document.createElement("div");
          header.style.cssText = "font-size:0.7rem;color:var(--color-text-muted);padding:5px 12px 3px;";
          header.textContent = "Déplacer vers…";
          menu.appendChild(header);
          for (const g of otherGroups) {
            const it = mkItem("📁", g.name);
            it.addEventListener("click", () => { this.mapController?.movePolygonToGroup(polyId, g.id); hideMenu(); });
            menu.appendChild(it);
          }
          menu.appendChild(mkSep());
        }
        const del = mkItem("🗑", "Supprimer le polygone", true);
        del.addEventListener("click", () => { this.mapController?.deletePolygon(polyId); hideMenu(); });
        menu.appendChild(del);

      } else if (groupRow && groupId) {
        const ren = mkItem("✏", "Renommer le dossier");
        ren.addEventListener("click", () => {
          hideMenu();
          const nameEl = groupRow.querySelector<HTMLElement>(".group-name");
          nameEl?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
        menu.appendChild(ren);

        const del = mkItem("🗑", "Supprimer le dossier", true);
        del.addEventListener("click", () => { this.mapController?.deleteGroup(groupId); hideMenu(); });
        menu.appendChild(del);

        menu.appendChild(mkSep());
        menu.appendChild(mkNewFolder());

      } else {
        menu.appendChild(mkNewFolder());
      }

      // Position — keep on screen
      menu.hidden = false;
      const rect = menu.getBoundingClientRect();
      const mx = Math.min(e.clientX, window.innerWidth - rect.width - 8);
      const my = Math.min(e.clientY, window.innerHeight - rect.height - 8);
      menu.style.left = `${mx}px`;
      menu.style.top = `${my}px`;
    });
  }

  renderLayerPanel(groups: GroupInfo[]): void {
    this.updateVertexEditButton(groups);

    const list = document.getElementById("polygon-layer-list");
    if (!list) return;

    const filterInput = document.getElementById("layer-filter") as HTMLInputElement | null;
    const filterText = filterInput?.value.toLowerCase().trim() ?? "";

    list.replaceChildren();

    const totalPolygons = groups.reduce((s, g) => s + g.polygons.length, 0);

    if (totalPolygons === 0) {
      const hint = document.createElement("p");
      hint.style.cssText = "font-size:0.75rem;color:var(--color-text-muted);font-style:italic;text-align:center;padding:8px 0;margin:0;";
      hint.textContent = "Cliquez sur + Nouveau ou ⬆ Importer pour commencer";
      list.appendChild(hint);
      return;
    }

    let draggedPolygonId: string | null = null;

    for (const group of groups) {
      // Filter polygons within the group
      const visiblePolys = filterText
        ? group.polygons.filter((p) => p.name.toLowerCase().includes(filterText))
        : group.polygons;

      // Skip empty groups when filtering
      if (filterText && visiblePolys.length === 0) continue;

      // ── Group header row ─────────────────────────────────────────────────────
      const groupRow = document.createElement("div");
      groupRow.className = "group-row";
      groupRow.dataset.groupId = group.id;

      const chevron = document.createElement("span");
      chevron.className = "group-chevron";
      chevron.textContent = group.collapsed ? "▶" : "▼";

      const icon = document.createElement("span");
      icon.textContent = "📁";
      icon.style.fontSize = "0.8rem";

      // Group name (double-click to rename)
      const groupName = document.createElement("span");
      groupName.className = "group-name";
      groupName.textContent = group.name;
      groupName.title = "Double-clic pour renommer";
      groupName.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.value = group.name;
        input.style.cssText = "flex:1;font-size:0.78rem;font-weight:600;background:var(--color-surface-2);color:var(--color-text);border:1px solid var(--color-accent-green);border-radius:4px;padding:1px 4px;width:100%;outline:none;";
        groupName.replaceWith(input);
        input.focus();
        input.select();
        const commit = () => {
          const newName = input.value.trim() || group.name;
          this.mapController?.renameGroup(group.id, newName);
        };
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") { ev.preventDefault(); commit(); }
          if (ev.key === "Escape") { ev.preventDefault(); this.mapController?.renameGroup(group.id, group.name); }
        });
        input.addEventListener("blur", commit);
      });

      // Count badge
      const countBadge = document.createElement("span");
      countBadge.style.cssText = "font-size:0.65rem;color:var(--color-text-muted);flex-shrink:0;";
      countBadge.textContent = `${visiblePolys.length}`;

      // Group KML export button
      const groupKmlBtn = document.createElement("button");
      groupKmlBtn.className = "btn-icon";
      groupKmlBtn.title = "Exporter ce dossier en KML";
      groupKmlBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
      groupKmlBtn.textContent = "⬇";
      groupKmlBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const data = this.mapController?.getGroupPolygonsForExport(group.id) ?? [];
        if (data.length > 0) downloadKml(buildKmlMulti(data));
      });

      // Group delete button
      const groupDelBtn = document.createElement("button");
      groupDelBtn.className = "btn-icon";
      groupDelBtn.title = "Supprimer ce dossier et ses polygones";
      groupDelBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
      groupDelBtn.textContent = "🗑";
      groupDelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.mapController?.deleteGroup(group.id);
      });

      groupRow.appendChild(chevron);
      groupRow.appendChild(icon);
      groupRow.appendChild(groupName);
      groupRow.appendChild(countBadge);
      groupRow.appendChild(groupKmlBtn);
      groupRow.appendChild(groupDelBtn);

      // Accessibility
      groupRow.setAttribute("role", "button");
      groupRow.setAttribute("tabindex", "0");
      groupRow.setAttribute("aria-expanded", String(!group.collapsed));

      // Toggle collapse on row click or Enter/Space
      groupRow.addEventListener("click", () => {
        this.mapController?.toggleGroupCollapse(group.id);
      });
      groupRow.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.mapController?.toggleGroupCollapse(group.id);
        }
      });

      // Drop directly on the folder header → append to group
      groupRow.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        groupRow.classList.add("drag-over-folder");
      });
      groupRow.addEventListener("dragleave", () => {
        groupRow.classList.remove("drag-over-folder");
      });
      groupRow.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        groupRow.classList.remove("drag-over-folder");
        if (draggedPolygonId) {
          this.mapController?.reorderPolygon(draggedPolygonId, null, group.id);
          draggedPolygonId = null;
        }
      });

      list.appendChild(groupRow);

      // ── Children container ───────────────────────────────────────────────────
      const children = document.createElement("div");
      children.className = "group-children" + (group.collapsed ? " collapsed" : "");
      children.dataset.parentGroup = group.id;

      // Group-level drop zone (fallback when not hovering a polygon row)
      children.addEventListener("dragover", (e) => {
        // Only show group-level indicator if not over a polygon row
        if (!(e.target as HTMLElement).closest(".polygon-layer-row")) {
          e.preventDefault();
          children.classList.add("drag-over");
        }
      });
      children.addEventListener("dragleave", (e) => {
        if (!children.contains(e.relatedTarget as Node)) {
          children.classList.remove("drag-over");
        }
      });
      children.addEventListener("drop", (e) => {
        if ((e.target as HTMLElement).closest(".polygon-layer-row")) return;
        e.preventDefault();
        children.classList.remove("drag-over");
        if (draggedPolygonId) {
          this.mapController?.reorderPolygon(draggedPolygonId, null, group.id);
          draggedPolygonId = null;
        }
      });

      for (const poly of visiblePolys) {
        const row = document.createElement("div");
        row.className = "polygon-layer-row" + (poly.isActive ? " active-layer" : poly.isSelected ? " selected-layer" : "");
        row.dataset.id = poly.id;
        row.draggable = true;

        row.addEventListener("dragstart", (e) => {
          draggedPolygonId = poly.id;
          e.dataTransfer?.setData("text/plain", poly.id);
          setTimeout(() => row.style.opacity = "0.4", 0);
        });
        row.addEventListener("dragend", () => {
          draggedPolygonId = null;
          row.style.opacity = "";
        });

        // Reorder indicator on dragover
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.stopPropagation();
          children.classList.remove("drag-over");
          const rect = row.getBoundingClientRect();
          const isUpperHalf = e.clientY < rect.top + rect.height / 2;
          row.classList.toggle("drag-insert-before", isUpperHalf);
          row.classList.toggle("drag-insert-after", !isUpperHalf);
        });
        row.addEventListener("dragleave", () => {
          row.classList.remove("drag-insert-before", "drag-insert-after");
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isBefore = row.classList.contains("drag-insert-before");
          row.classList.remove("drag-insert-before", "drag-insert-after");
          children.classList.remove("drag-over");
          if (draggedPolygonId && draggedPolygonId !== poly.id) {
            if (isBefore) {
              this.mapController?.reorderPolygon(draggedPolygonId, poly.id, group.id);
            } else {
              // Insert after: find the next polygon in this group
              const groupPolys = group.polygons;
              const idx = groupPolys.findIndex((p) => p.id === poly.id);
              const nextPoly = groupPolys[idx + 1];
              this.mapController?.reorderPolygon(draggedPolygonId, nextPoly?.id ?? null, group.id);
            }
          }
          draggedPolygonId = null;
        });

        // Color dot
        const dot = document.createElement("span");
        dot.className = "polygon-color-dot";
        dot.style.background = poly.color;

        // Name (double-click to rename)
        const name = document.createElement("span");
        name.style.cssText = "flex:1;font-size:0.8rem;font-weight:500;color:var(--color-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;";
        name.title = "Double-clic pour renommer";
        name.textContent = poly.name;
        name.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          const input = document.createElement("input");
          input.value = poly.name;
          input.style.cssText = "flex:1;font-size:0.8rem;font-weight:500;background:var(--color-surface-2);color:var(--color-text);border:1px solid var(--color-accent-green);border-radius:4px;padding:1px 4px;width:100%;outline:none;";
          name.replaceWith(input);
          input.focus();
          input.select();
          const commit = () => {
            const newName = input.value.trim() || poly.name;
            this.mapController?.renamePolygon(poly.id, newName);
          };
          input.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter") { ev.preventDefault(); commit(); }
            if (ev.key === "Escape") { ev.preventDefault(); this.mapController?.renamePolygon(poly.id, poly.name); }
          });
          input.addEventListener("blur", commit);
        });

        // Status badge
        const badge = document.createElement("span");
        if (poly.isImported) {
          badge.style.cssText = "font-size:0.68rem;padding:2px 5px;border-radius:3px;background:rgba(251,191,36,0.15);color:#fbbf24;flex-shrink:0;";
          badge.textContent = poly.vertexCount ? `${poly.vertexCount} pts` : "Importé";
        } else {
          badge.style.cssText = `font-size:0.68rem;padding:2px 5px;border-radius:3px;background:${poly.isClosed ? "rgba(0,229,160,0.15)" : "rgba(129,140,248,0.15)"};color:${poly.isClosed ? "#00e5a0" : "#818cf8"};flex-shrink:0;`;
          badge.textContent = poly.isClosed ? "Fermé" : "En cours";
        }

        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(badge);

        // Per-polygon KML download (only when closed)
        if (poly.isClosed) {
          const kmlBtn = document.createElement("button");
          kmlBtn.className = "btn-icon";
          kmlBtn.title = "Télécharger KML";
          kmlBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
          kmlBtn.textContent = "⬇";
          kmlBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const data = this.mapController?.getPolygonForExport(poly.id);
            if (data) downloadKml(buildKmlMulti([data]));
          });
          row.appendChild(kmlBtn);
        }

        // Delete button
        const delBtn = document.createElement("button");
        delBtn.className = "btn-icon";
        delBtn.title = "Supprimer ce polygone";
        delBtn.style.cssText = "font-size:0.75rem;padding:2px 4px;flex-shrink:0;";
        delBtn.textContent = "🗑";
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.mapController?.deletePolygon(poly.id);
        });
        row.appendChild(delBtn);

        // Click row to select polygon (Ctrl+click adds to selection)
        row.addEventListener("click", (e) => {
          this.mapController?.selectPolygon(poly.id, e.ctrlKey || e.metaKey);
        });

        children.appendChild(row);
      }

      list.appendChild(children);
    }
  }

  // ─── KML import ──────────────────────────────────────────────────────────────

  private bindKmlImport(): void {
    const btn = document.getElementById("btn-import-kml");
    const input = document.getElementById("input-kml-file") as HTMLInputElement | null;
    const progressEl = document.getElementById("import-progress");
    const progressText = document.getElementById("import-progress-text");
    const progressBar = document.getElementById("import-progress-bar") as HTMLElement | null;

    if (!btn || !input) return;

    btn.addEventListener("click", () => input.click());

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      input.value = ""; // allow re-selecting the same file

      if (!file.name.toLowerCase().endsWith(".kml")) {
        this.showError("Fichier invalide — seuls les fichiers .kml sont supportés.");
        return;
      }

      if (progressEl) progressEl.style.display = "block";
      btn.setAttribute("disabled", "");

      try {
        const polygons = await parseKmlFile(file, (p) => {
          const pct = Math.round((p.parsed / p.total) * 100);
          if (progressText) progressText.textContent = `${p.parsed} / ${p.total} — ${p.currentName}`;
          if (progressBar) progressBar.style.width = `${pct}%`;
        });

        if (polygons.length === 0) {
          throw new Error("Aucun polygone trouvé dans ce fichier KML.");
        }

        // Strip file extension for the group name, truncated to 30 chars
        const groupName = file.name.replace(/\.[^.]+$/, "").slice(0, 30) || "Import";
        this.mapController?.importPolygons(polygons, groupName);
        this.updateActionButtons();
        if (progressText) progressText.textContent = `${polygons.length} polygones importés`;
        setTimeout(() => {
          if (progressEl) progressEl.style.display = "none";
          if (progressBar) progressBar.style.width = "0%";
        }, 2000);
      } catch (err) {
        this.showError(err instanceof Error ? err.message : "Erreur lors de l'import KML.");
        if (progressEl) progressEl.style.display = "none";
      } finally {
        btn.removeAttribute("disabled");
      }
    });
  }

  // ─── Snap / magnet tool ──────────────────────────────────────────────────────

  private bindSnapToggle(): void {
    const btn = document.getElementById("btn-snap-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      this.snapActive = !this.snapActive;
      btn.classList.toggle("active-snap", this.snapActive);
      this.mapController?.setSnapMode(this.snapActive);
    });
  }

  // ─── Provider toggle ─────────────────────────────────────────────────────────

  private bindProviderToggle(): void {
    const btn = document.getElementById("btn-provider-toggle");
    if (!btn) return;
    const saved = (localStorage.getItem("tm_map_provider") ?? "google") as MapProvider;
    this.updateProviderBtn(btn, saved);
    btn.addEventListener("click", async () => {
      const current = (localStorage.getItem("tm_map_provider") ?? "google") as MapProvider;
      const next: MapProvider = current === "google" ? "osm" : "google";
      localStorage.setItem("tm_map_provider", next);
      this.updateProviderBtn(btn, next);
      if (this.isMapLoaded) await this.switchProvider();
    });
  }

  private updateProviderBtn(btn: HTMLElement, provider: MapProvider): void {
    const img = document.getElementById("btn-provider-icon") as HTMLImageElement | null;
    if (img) {
      img.src = provider === "google" ? "/gm.avif" : "/osm.avif";
      img.alt = provider === "google" ? "Google Maps" : "OpenStreetMap";
    }
    btn.classList.toggle("active-provider-osm", provider === "osm");
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
    const polygons = this.mapController?.getAllPolygonsForExport() ?? [];
    if (polygons.length === 0) return null;
    return buildKmlMulti(polygons);
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
