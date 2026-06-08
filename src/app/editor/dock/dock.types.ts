/** Identifiers for every movable panel in the editor. */
export type PanelId =
  | 'tools'
  | 'color'
  | 'display'
  | 'canvas'
  | 'timeline';

export const PANEL_IDS: PanelId[] = [
  'tools',
  'color',
  'display',
  'canvas',
  'timeline',
];

/** Dockable edge zones. The center (canvas) is fixed and not a zone. */
export type Zone = 'left' | 'right' | 'bottom';
export const ZONES: Zone[] = ['left', 'right', 'bottom'];

export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatPanel {
  id: PanelId;
  rect: FloatRect;
  z: number;
}

export interface DockState {
  /** Ordered panel ids per dock zone. */
  zones: Record<Zone, PanelId[]>;
  /** Panels torn off into free-floating windows. */
  floating: FloatPanel[];
  /** Panels whose body is collapsed (header only). */
  collapsed: PanelId[];
  /** Panels closed from view entirely. */
  hidden: PanelId[];
}

export const PANEL_TITLES: Record<PanelId, string> = {
  tools: 'Tools',
  color: 'Color & Palette',
  display: 'Display',
  canvas: 'Canvas',
  timeline: 'Timeline',
};

export function defaultDockState(): DockState {
  return {
    zones: {
      left: ['tools', 'color'],
      right: ['display', 'canvas'],
      bottom: ['timeline'],
    },
    floating: [],
    collapsed: [],
    hidden: [],
  };
}

// Bump this when the default layout changes so stale saved layouts are discarded.
export const DOCK_STORAGE_KEY = 'pixelart.dock.v8';
