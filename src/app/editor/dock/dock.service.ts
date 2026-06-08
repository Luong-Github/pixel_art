import { Injectable } from '@angular/core';
import {
  DockState,
  DOCK_STORAGE_KEY,
  FloatRect,
  PanelId,
  PANEL_IDS,
  ZONES,
  Zone,
  defaultDockState,
} from './dock.types';

/**
 * Owns the editor's panel layout: which panels are docked where, which are
 * floating, collapsed or hidden. Every mutation persists to localStorage so the
 * layout survives reloads. Not provided in root — one instance per editor.
 */
@Injectable()
export class DockService {
  state: DockState = defaultDockState();
  private zCounter = 10;
  /** Last dock zone a panel occupied before being hidden (for restore). */
  private lastZone: Partial<Record<PanelId, Zone>> = {};

  constructor() {
    this.load();
  }

  // ---- persistence -------------------------------------------------------

  load(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(DOCK_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<DockState>;
      const next = this.sanitize(parsed);
      if (next) {
        this.state = next;
        this.zCounter = this.state.floating.reduce((m, f) => Math.max(m, f.z), 10) + 1;
      }
    } catch {
      /* ignore corrupt layout */
    }
  }

  save(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }

  reset(): void {
    this.state = defaultDockState();
    this.save();
  }

  /** Ensure a parsed layout references every known panel exactly once. */
  private sanitize(input: Partial<DockState>): DockState | null {
    if (!input || typeof input !== 'object') return null;
    const base = defaultDockState();
    const seen = new Set<PanelId>();
    const zones: DockState['zones'] = { left: [], right: [], bottom: [] };
    for (const zone of ZONES) {
      const ids = Array.isArray(input.zones?.[zone]) ? input.zones![zone] : [];
      for (const id of ids) {
        if (PANEL_IDS.includes(id) && !seen.has(id)) {
          seen.add(id);
          zones[zone].push(id);
        }
      }
    }
    const floating = Array.isArray(input.floating) ? input.floating : [];
    const validFloating = floating.filter(
      (f) => f && PANEL_IDS.includes(f.id) && f.rect && !seen.has(f.id) && seen.add(f.id),
    );
    const hidden = (Array.isArray(input.hidden) ? input.hidden : []).filter(
      (id) => PANEL_IDS.includes(id) && !seen.has(id) && seen.add(id),
    );
    // Any panel not accounted for falls back to its default zone.
    for (const id of PANEL_IDS) {
      if (!seen.has(id)) {
        const home = (Object.keys(base.zones) as Zone[]).find((z) =>
          base.zones[z].includes(id),
        )!;
        zones[home].push(id);
      }
    }
    const collapsed = (Array.isArray(input.collapsed) ? input.collapsed : []).filter((id) =>
      PANEL_IDS.includes(id),
    );
    return { zones, floating: validFloating, collapsed, hidden };
  }

  // ---- queries -----------------------------------------------------------

  zoneOf(id: PanelId): Zone | null {
    for (const zone of ZONES) if (this.state.zones[zone].includes(id)) return zone;
    return null;
  }

  isFloating(id: PanelId): boolean {
    return this.state.floating.some((f) => f.id === id);
  }

  isHidden(id: PanelId): boolean {
    return this.state.hidden.includes(id);
  }

  isCollapsed(id: PanelId): boolean {
    return this.state.collapsed.includes(id);
  }

  floatOf(id: PanelId): import('./dock.types').FloatPanel | undefined {
    return this.state.floating.find((f) => f.id === id);
  }

  zoneEmpty(zone: Zone): boolean {
    return this.state.zones[zone].length === 0;
  }

  // ---- mutations ---------------------------------------------------------

  private detach(id: PanelId): void {
    for (const zone of ZONES) {
      this.state.zones[zone] = this.state.zones[zone].filter((p) => p !== id);
    }
    this.state.floating = this.state.floating.filter((f) => f.id !== id);
    this.state.hidden = this.state.hidden.filter((p) => p !== id);
  }

  dock(id: PanelId, zone: Zone, index?: number): void {
    this.detach(id);
    const arr = this.state.zones[zone];
    if (index === undefined || index < 0 || index > arr.length) arr.push(id);
    else arr.splice(index, 0, id);
    this.save();
  }

  float(id: PanelId, rect: FloatRect): void {
    this.detach(id);
    this.state.floating.push({ id, rect, z: ++this.zCounter });
    this.save();
  }

  setRect(id: PanelId, rect: Partial<FloatRect>): void {
    const f = this.floatOf(id);
    if (!f) return;
    f.rect = { ...f.rect, ...rect };
    this.save();
  }

  bringToFront(id: PanelId): void {
    const f = this.floatOf(id);
    if (!f) return;
    f.z = ++this.zCounter;
  }

  toggleCollapse(id: PanelId): void {
    if (this.isCollapsed(id)) this.state.collapsed = this.state.collapsed.filter((p) => p !== id);
    else this.state.collapsed.push(id);
    this.save();
  }

  hide(id: PanelId): void {
    // Remember where it lived so re-showing restores it to the same zone.
    this.lastZone[id] = this.zoneOf(id) ?? this.lastZone[id] ?? this.homeZoneOf(id);
    this.detach(id);
    this.state.hidden.push(id);
    this.save();
  }

  /** The zone a panel belongs to in the default layout. */
  private homeZoneOf(id: PanelId): Zone {
    const def = defaultDockState();
    for (const zone of ZONES) {
      if (def.zones[zone].includes(id)) return zone;
    }
    return 'right';
  }

  /** Show a hidden panel, restoring it to its previous (or home) zone. */
  show(id: PanelId, zone?: Zone): void {
    if (!this.isHidden(id)) return;
    this.dock(id, zone ?? this.lastZone[id] ?? this.homeZoneOf(id));
  }

  toggleHidden(id: PanelId): void {
    if (this.isHidden(id)) this.show(id);
    else this.hide(id);
  }
}
