import {
  AfterViewChecked,
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  Inject,
  PLATFORM_ID,
  QueryList,
  TemplateRef,
  ViewChild,
  ViewChildren,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import {
  CdkDragDrop,
  DragDropModule,
  moveItemInArray,
  transferArrayItem,
} from '@angular/cdk/drag-drop';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { DockService } from './dock/dock.service';
import { PremiumService } from './premium.service';
import { ProjectStoreService, ProjectMeta } from './projects/project-store.service';
import { LocaleService } from '../i18n/locale.service';
import { NotificationService } from '../core/notify/notification.service';
import { WelcomeComponent } from './onboarding/welcome.component';
import { TranslatePipe } from '../i18n/translate.pipe';
import { Lang } from '../i18n/translations';
import { BUILTIN_PALETTES, NamedPalette, PALETTE_STORAGE_KEY } from './palettes';
import { DockPanelDefDirective } from './dock/dock-panel-def.directive';
import {
  FloatRect,
  PanelId,
  PANEL_IDS,
  PANEL_TITLES,
  Zone,
  ZONES,
} from './dock/dock.types';

interface FloatDragState {
  id: PanelId;
  pointerId: number;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startRect: FloatRect;
}

type Tool =
  | 'pen'
  | 'eraser'
  | 'fill'
  | 'gradient'
  | 'shade'
  | 'spray'
  | 'picker'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'select'
  | 'wand'
  | 'lasso'
  | 'move'
  | 'transform';
type Pixel = string | null;
/** One channel's Levels parameters (input black/white + gamma, output black/white). */
interface LevelCh { inB: number; inW: number; gamma: number; outB: number; outW: number; }
type ImportFit = 'contain' | 'cover' | 'stretch';
/** Symmetry axes for drawing. 'mandala' = 8-fold radial (square canvas only). */
type SymmetryMode = 'off' | 'x' | 'y' | 'both' | 'mandala';

interface SourceRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SampleOptions {
  sourceRect?: SourceRect;
  transparentWhite?: boolean;
}

interface PixelBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'add'
  | 'difference';

interface Layer {
  name: string;
  visible: boolean;
  locked?: boolean;
  opacity: number;
  blend?: BlendMode;
  /** Owning group id, or null/undefined when ungrouped. */
  groupId?: number | null;
  pixels: Pixel[];
}

interface Frame {
  name: string;
  duration: number;
  visible: boolean;
  layers: Layer[];
}

type TagDirection = 'forward' | 'reverse' | 'pingpong';

/** A named range of frames (Aseprite-style animation tag). */
interface AnimTag {
  id: number;
  name: string;
  from: number;
  to: number;
  color: string;
  direction: TagDirection;
  /** Loop count for engine export; 0 = forever. */
  repeat: number;
}

/** A layer folder. Membership is by `Layer.groupId`; state lives at workspace level. */
interface LayerGroup {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  collapsed: boolean;
  opacity: number;
  color: string;
}

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Pixel[];
  /** Optional per-cell mask (length w*h, row-major) for non-rectangular shapes. */
  mask?: boolean[];
}

interface PointerState {
  x: number;
  y: number;
  startX: number;
  startY: number;
}

interface PanState {
  pointerId: number;
  clientX: number;
  clientY: number;
  scrollLeft: number;
  scrollTop: number;
}

type ResizePane = 'left' | 'right' | 'bottom';

interface PaneResizeState {
  pane: ResizePane;
  pointerId: number;
  clientX: number;
  clientY: number;
  startLeftWidth: number;
  startRightWidth: number;
  startBottomHeight: number;
}

/** Per-tab view/config — kept independent across workspaces. */
interface WorkspaceView {
  zoom: number;
  displayZoom: number;
  showGrid: boolean;
  symmetry: SymmetryMode;
  pixelPerfect: boolean;
  brushSize: number;
  pivotPreset: 'center' | 'feet' | 'topleft';
  sheetColumns: number;
  onionSkin: boolean;
  onionTint: boolean;
  onionPrevOpacity: number;
  onionNextOpacity: number;
}

interface WorkspaceState {
  id: number;
  name: string;
  width: number;
  height: number;
  frames: Frame[];
  tags: AnimTag[];
  groups: LayerGroup[];
  activeFrameIndex: number;
  activeLayerIndex: number;
  palette: string[];
  primaryColor: string;
  secondaryColor: string;
  /** Per-tab view config (zoom, grid, symmetry, …). */
  view?: WorkspaceView;
}

interface PixelArtProjectFile {
  app: 'Pixel Studio';
  version: 1;
  exportedAt: string;
  activeWorkspaceIndex: number;
  workspaceIdSeed: number;
  workspaces: WorkspaceState[];
  settings: {
    zoom: number;
    displayZoom: number;
    showGrid: boolean;
    onionSkin: boolean;
    mirrorX?: boolean;
    symmetry?: SymmetryMode;
    pixelPerfect?: boolean;
    brushSize: number;
    importResizeCanvas: boolean;
    importLongSide: number;
    importFit: ImportFit;
    importPaletteSize: number;
    importDither: boolean;
    importSharpen: number;
    importContrast: number;
  };
}

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DragDropModule, DockPanelDefDirective, TranslatePipe, WelcomeComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
  host: { class: 'editor-host' },
  providers: [DockService],
})
export class EditorComponent implements AfterViewInit, AfterViewChecked {
  @ViewChild('stage', { static: true })
  stageRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('display')
  displayRef?: ElementRef<HTMLCanvasElement>;
  private displayCanvasEl?: HTMLCanvasElement;
  @ViewChild('tilemapCanvas')
  tilemapRef?: ElementRef<HTMLCanvasElement>;
  private tilemapCanvasEl?: HTMLCanvasElement;
  private tilemapCtx?: CanvasRenderingContext2D;
  @ViewChild('minimapCanvas')
  minimapRef?: ElementRef<HTMLCanvasElement>;
  private minimapEl?: HTMLCanvasElement;
  private minimapCtx?: CanvasRenderingContext2D;
  minimapOn = true;
  private minimapDragging = false;
  @ViewChild('canvasWrap', { static: true })
  canvasWrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild('importInput', { static: true })
  importInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('projectInput', { static: true })
  projectInputRef!: ElementRef<HTMLInputElement>;

  @ViewChildren(DockPanelDefDirective)
  private panelDefs!: QueryList<DockPanelDefDirective>;
  @ViewChildren('zoneEl')
  private zoneEls!: QueryList<ElementRef<HTMLElement>>;
  @ViewChild('layerMenuEl')
  private layerMenuRef?: ElementRef<HTMLElement>;

  @ViewChild('tagMenuEl')
  private tagMenuRef?: ElementRef<HTMLElement>;

  @ViewChild('groupMenuEl')
  private groupMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('paletteMenuEl')
  private paletteMenuRef?: ElementRef<HTMLElement>;
  @ViewChild('paletteColorInput')
  private paletteColorInputRef?: ElementRef<HTMLInputElement>;
  @ViewChild('dlgInput')
  private dlgInputRef?: ElementRef<HTMLInputElement>;

  /** Map of panel id -> body template, populated after view init. */
  panelTemplates = new Map<PanelId, TemplateRef<unknown>>();
  readonly panelIds = PANEL_IDS;
  readonly panelTitles = PANEL_TITLES;
  readonly zones = ZONES;
  panelsMenuOpen = false;
  dropTargetZone: Zone | null = null;
  /** True while any panel (CDK or floating) is being dragged. */
  dragActive = false;
  private floatDrag: FloatDragState | null = null;

  private readonly isBrowser: boolean;

  exportMenuOpen = false;
  fileMenuOpen = false;
  editMenuOpen = false;
  convertModalOpen = false;
  /** Right-click context menu for a layer row ({x,y} viewport coords + layer index). */
  layerMenu: { x: number; y: number; index: number } | null = null;
  /** Right-click context menu for a palette swatch ({x,y} coords + palette index). */
  paletteMenu: { x: number; y: number; index: number } | null = null;
  /** Swatch index being edited via the native colour picker (survives menu close). */
  private paletteEditIndex = -1;
  /** Custom prompt/confirm/alert dialog (replaces window.prompt/confirm/alert). */
  dialog: {
    type: 'prompt' | 'confirm' | 'alert';
    title: string;
    message?: string;
    value?: string;
    placeholder?: string;
    okLabel: string;
    cancelLabel?: string;
    danger?: boolean;
  } | null = null;
  private dialogResolve: ((value: string | boolean | null) => void) | null = null;

  // ---- Project library (IndexedDB-backed; swappable for a backend later) ----
  /** localStorage key linking the current session to a saved project. */
  private readonly currentProjectKey = 'pixelart.currentProjectId';
  projectsModalOpen = false;
  projectsTab: 'save' | 'recent' = 'save';
  recentProjects: ProjectMeta[] = [];
  currentProjectId: string | null = null;
  /** Name field bound in the Save tab. */
  saveName = '';
  saveState: 'idle' | 'saving' | 'saved' | 'error' = 'idle';
  /** Where an imported image should land. */
  importTarget: 'current' | 'new' = 'current';
  /** Sanitized inline SVG icons keyed by tool id. */
  toolIcons: Record<string, SafeHtml> = {};
  /** Sanitized inline SVG icons for action buttons (transform, color). */
  uiIcons: Record<
    | 'rotateL' | 'rotateR' | 'flipH' | 'flipV'
    | 'arrowL' | 'arrowR' | 'arrowU' | 'arrowD'
    | 'copy' | 'cut' | 'paste' | 'swap' | 'pick',
    SafeHtml
  > = {} as Record<string, SafeHtml> as never;

  constructor(
    public dock: DockService,
    public premium: PremiumService,
    public locale: LocaleService,
    private projectStore: ProjectStoreService,
    private notify: NotificationService,
    private hostRef: ElementRef<HTMLElement>,
    private sanitizer: DomSanitizer,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.buildToolIcons();
    this.buildUiIcons();
    this.loadSavedPalettes();
    if (this.isBrowser) {
      try {
        this.currentProjectId = localStorage.getItem(this.currentProjectKey);
        this.showWelcome = localStorage.getItem(this.onboardedKey) !== '1';
      } catch {
        /* storage unavailable */
      }
    }
  }

  // ----- First-run welcome -----
  private readonly onboardedKey = 'pixelart.onboarded';
  showWelcome = false;

  /** Close the welcome card and remember it (so it won't show again). */
  dismissWelcome(): void {
    this.showWelcome = false;
    try {
      localStorage.setItem(this.onboardedKey, '1');
    } catch {
      /* storage unavailable */
    }
  }

  /** Re-open the welcome card from View ▾. */
  replayWelcome(): void {
    this.panelsMenuOpen = false;
    this.showWelcome = true;
  }

  private buildUiIcons(): void {
    const s =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    const icons: Record<string, string> = {
      rotateL: `${s}<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>`,
      rotateR: `${s}<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>`,
      flipH: `${s}<path d="M12 3v18"/><path d="M8 8L4 12l4 4"/><path d="M16 8l4 4-4 4"/></svg>`,
      flipV: `${s}<path d="M3 12h18"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/></svg>`,
      arrowL: `${s}<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>`,
      arrowR: `${s}<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>`,
      arrowU: `${s}<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>`,
      arrowD: `${s}<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>`,
      copy: `${s}<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>`,
      cut: `${s}<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5l12 9M8 16.5l12-9"/></svg>`,
      paste: `${s}<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/></svg>`,
      swap: `${s}<path d="M7 4L3 8l4 4"/><path d="M3 8h13"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8"/></svg>`,
      pick: `${s}<path d="M3 21l1-4 9.5-9.5 3 3L7 20z"/><path d="M14.5 4.5l2-2a2.1 2.1 0 0 1 3 3l-2 2"/></svg>`,
    };
    const map: Record<string, SafeHtml> = {};
    for (const key of Object.keys(icons)) {
      map[key] = this.sanitizer.bypassSecurityTrustHtml(icons[key]);
    }
    this.uiIcons = map as typeof this.uiIcons;
  }

  toggleFileMenu(): void {
    const open = !this.fileMenuOpen;
    this.closeTopMenus();
    this.fileMenuOpen = open;
  }

  toggleEditMenu(): void {
    const open = !this.editMenuOpen;
    this.closeTopMenus();
    this.editMenuOpen = open;
  }

  /** Localized panel title (falls back to the static English title). */
  panelTitle(id: PanelId): string {
    return this.locale.t('panel.' + id);
  }

  setLang(lang: Lang): void {
    this.locale.setLang(lang);
  }

  openConvertModal(): void {
    this.fileMenuOpen = false;
    // Default to a new tab when the current one already has artwork.
    this.importTarget = this.workspaceInProgress ? 'new' : 'current';
    this.convertModalOpen = true;
  }

  closeConvertModal(): void {
    this.convertModalOpen = false;
  }

  /** True when the active workspace has drawn content (multiple frames or any pixel). */
  get workspaceInProgress(): boolean {
    if (this.frames.length > 1) return true;
    for (const frame of this.frames) {
      for (const layer of frame.layers) {
        if (layer.pixels.some((p) => p !== null)) return true;
      }
    }
    return false;
  }

  /** Triggered by the modal's "Choose image & convert"; confirms before overwriting. */
  async startImageImport(): Promise<void> {
    if (this.importTarget === 'current' && this.workspaceInProgress) {
      const ok = await this.askConfirm({
        title: 'Overwrite this tab?',
        message:
          'This tab already has artwork — importing here will overwrite it. Choose “New tab” to keep your current work.',
        okLabel: 'Overwrite',
        danger: true,
      });
      if (!ok) return;
    }
    this.triggerImport();
  }

  private buildToolIcons(): void {
    const s =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    const icons: Record<string, string> = {
      pen: `${s}<path d="M16.5 3.5l4 4L8 20l-4.5 1L4.5 16.5z"/><path d="M13.5 6.5l4 4"/></svg>`,
      eraser: `${s}<path d="M4 14.5l7-7 6.5 6.5-5 5H7z"/><path d="M3.5 21h11"/></svg>`,
      fill: `${s}<path d="M6.5 3.5l9 9-6.5 6.5a2.5 2.5 0 0 1-3.5 0l-3-3a2.5 2.5 0 0 1 0-3.5z"/><path d="M9 6l8 8"/><path d="M20 14.5s1.5 2 1.5 3.2A1.7 1.7 0 0 1 18.5 18c0-1.2 1.5-3.5 1.5-3.5z"/></svg>`,
      gradient: `${s}<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h.01M11 8h.01M15 8h.01M7 12h.01M11 12h.01M9 16h.01"/></svg>`,
      shade: `${s}<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>`,
      spray: `${s}<path d="M9 8h6l1 12H8z"/><path d="M9 8V5h6v3"/><path d="M18 4h.01M20 6h.01M19 9h.01M21 11h.01M18 12h.01"/></svg>`,
      picker: `${s}<path d="M3 21l1-4 9.5-9.5 3 3L7 20z"/><path d="M14.5 4.5l2-2a2.1 2.1 0 0 1 3 3l-2 2"/></svg>`,
      line: `${s}<line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="5" r="1.4" fill="currentColor"/></svg>`,
      rect: `${s}<rect x="4" y="5" width="16" height="14" rx="1"/></svg>`,
      ellipse: `${s}<circle cx="12" cy="12" r="8"/></svg>`,
      select: `${s.replace('stroke-width="2"', 'stroke-width="2" stroke-dasharray="3 3"')}<rect x="4" y="4" width="16" height="16" rx="1"/></svg>`,
      wand: `${s}<path d="M4 20l9-9"/><path d="M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/><path d="M19 11l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/></svg>`,
      lasso: `${s.replace('stroke-width="2"', 'stroke-width="2" stroke-dasharray="3 3"')}<path d="M4 11a8 5 0 1 1 8 5c-3 0-3 3-1 3"/><path d="M11 19a1.3 1.3 0 1 1 0-.01"/></svg>`,
      transform: `${s}<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/><rect x="2" y="2" width="3.2" height="3.2" fill="currentColor" stroke="none"/><rect x="18.8" y="2" width="3.2" height="3.2" fill="currentColor" stroke="none"/><rect x="2" y="18.8" width="3.2" height="3.2" fill="currentColor" stroke="none"/><rect x="18.8" y="18.8" width="3.2" height="3.2" fill="currentColor" stroke="none"/></svg>`,
      move: `${s}<line x1="12" y1="3" x2="12" y2="21"/><line x1="3" y1="12" x2="21" y2="12"/><polyline points="9 6 12 3 15 6"/><polyline points="9 18 12 21 15 18"/><polyline points="6 9 3 12 6 15"/><polyline points="18 9 21 12 18 15"/></svg>`,
    };
    const map: Record<string, SafeHtml> = {};
    for (const key of Object.keys(icons)) {
      map[key] = this.sanitizer.bypassSecurityTrustHtml(icons[key]);
    }
    this.toolIcons = map;
  }

  readonly tools: { id: Tool; label: string; key: string }[] = [
    { id: 'pen', label: 'Pen', key: 'P' },
    { id: 'eraser', label: 'Erase', key: 'E' },
    { id: 'fill', label: 'Fill', key: 'B' },
    { id: 'gradient', label: 'Gradient', key: 'D' },
    { id: 'shade', label: 'Shade', key: 'A' },
    { id: 'spray', label: 'Spray', key: 'K' },
    { id: 'picker', label: 'Pick', key: 'I' },
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'rect', label: 'Rect', key: 'R' },
    { id: 'ellipse', label: 'Oval', key: 'O' },
    { id: 'select', label: 'Select', key: 'S' },
    { id: 'wand', label: 'Wand', key: 'W' },
    { id: 'lasso', label: 'Lasso', key: 'Q' },
    { id: 'move', label: 'Move', key: 'M' },
    { id: 'transform', label: 'Transform', key: 'T' },
  ];

  /** Tools grouped for the Tools panel (separators + labels). */
  readonly toolGroups: { label: string; ids: Tool[] }[] = [
    { label: 'Draw', ids: ['pen', 'eraser', 'fill', 'gradient', 'shade', 'spray', 'picker'] },
    { label: 'Shape', ids: ['line', 'rect', 'ellipse'] },
    { label: 'Select', ids: ['select', 'wand', 'lasso', 'move', 'transform'] },
  ];
  tool(id: Tool): { id: Tool; label: string; key: string } {
    return this.tools.find((t) => t.id === id)!;
  }

  /** Active tab in the Color & Palette panel. */
  colorTab: 'color' | 'palette' = 'color';

  /** Command palette (Ctrl+K). */
  paletteOpen = false;
  commandQuery = '';
  commandIndex = 0;
  @ViewChild('cmdInput')
  private cmdInputRef?: ElementRef<HTMLInputElement>;

  get commands(): { label: string; hint?: string; run: () => void }[] {
    return [
      ...this.tools.map((t) => ({
        label: `Tool: ${t.label}`,
        hint: t.key,
        run: () => this.setTool(t.id),
      })),
      { label: 'Undo', hint: 'Ctrl+Z', run: () => this.undo() },
      { label: 'Redo', hint: 'Ctrl+Y', run: () => this.redo() },
      { label: 'New sprite', run: () => this.newSprite() },
      { label: 'Fit to screen', run: () => this.fitToScreen() },
      {
        label: 'Toggle grid',
        hint: 'G',
        run: () => {
          this.showGrid = !this.showGrid;
          this.render();
        },
      },
      {
        label: 'Toggle onion skin',
        run: () => {
          this.onionSkin = !this.onionSkin;
          this.render();
        },
      },
      { label: 'Add layer', run: () => this.addLayer() },
      { label: 'Add frame', run: () => this.addFrame() },
      { label: 'Duplicate frame', run: () => this.duplicateFrame() },
      { label: 'Outline layer (secondary)', run: () => this.outlineLayer() },
      { label: 'Replace secondary → primary', run: () => this.replaceColor() },
      { label: 'Recolor sprite to palette', run: () => this.remapToPalette() },
      { label: 'Color adjustments…', hint: 'Ctrl+L', run: () => this.openAdjust() },
      { label: 'Toggle tilemap panel', run: () => this.dock.toggleHidden('tilemap') },
      { label: 'Export PNG ×1', run: () => this.exportPngScale(1) },
      { label: 'Export PNG ×2', run: () => this.exportPngScale(2) },
      { label: 'Export animated GIF', run: () => this.exportGif(1) },
      {
        label: 'Export sprite sheet',
        run: () => this.exportSpriteSheet('grid', 1),
      },
      { label: 'Export project (.json)', run: () => this.exportProject() },
      { label: 'Import / convert image…', run: () => this.openConvertModal() },
      { label: 'Record timelapse', run: () => this.toggleRecording() },
      {
        label: 'Toggle minimap',
        run: () => {
          this.minimapOn = !this.minimapOn;
          this.render();
        },
      },
      {
        label: 'Toggle brush stabilizer',
        run: () => {
          this.stabilizer = !this.stabilizer;
        },
      },
      { label: 'Reset layout', run: () => this.resetLayout() },
    ];
  }

  get filteredCommands(): { label: string; hint?: string; run: () => void }[] {
    const q = this.commandQuery.trim().toLowerCase();
    const list = this.commands;
    return q ? list.filter((c) => c.label.toLowerCase().includes(q)) : list;
  }

  toggleCommandPalette(): void {
    this.paletteOpen = !this.paletteOpen;
    if (this.paletteOpen) {
      this.commandQuery = '';
      this.commandIndex = 0;
      if (this.isBrowser) {
        requestAnimationFrame(() => this.cmdInputRef?.nativeElement.focus());
      }
    }
  }
  closeCommandPalette(): void {
    this.paletteOpen = false;
  }
  onCommandQueryChange(): void {
    this.commandIndex = 0;
  }
  commandKeydown(event: KeyboardEvent): void {
    const list = this.filteredCommands;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.closeCommandPalette();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.commandIndex = Math.min(this.commandIndex + 1, list.length - 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.commandIndex = Math.max(this.commandIndex - 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.runCommandAt(this.commandIndex);
    } else if (event.key === 'Escape') {
      this.closeCommandPalette();
    }
  }
  runCommandAt(i: number): void {
    const list = this.filteredCommands;
    const cmd = list[this.clamp(i, 0, list.length - 1)];
    this.paletteOpen = false;
    if (cmd) cmd.run();
  }

  width = 32;
  height = 32;
  leftPanelWidth = 220;
  rightPanelWidth = 320;
  bottomPanelHeight = 210;
  layersMinimized = false;
  framesMinimized = false;
  zoom = 4;
  readonly minZoom = 1;
  readonly maxZoom = 40;
  displayZoom = 6;
  importResizeCanvas = true;
  importLongSide = 96;
  importFit: ImportFit = 'contain';
  importPaletteSize = 32;
  importDither = true;
  importSharpen = 0.35;
  importContrast = 1.08;
  showGrid = true;
  onionSkin = false;
  /** Onion skin display options (render-only, never touch pixel data). */
  onionPrevOpacity = 0.4;
  onionNextOpacity = 0.25;
  onionTint = true;
  /** Drawing symmetry (replaces the old mirror-X toggle). */
  symmetry: SymmetryMode = 'off';
  /** Pixel-perfect freehand: drop redundant corner pixels (brush size 1). */
  pixelPerfect = false;
  activeTool: Tool = 'pen';
  primaryColor = '#222831';
  secondaryColor = '#f6f1de';
  /** Hue retained for the HSV picker when the colour is grayscale. */
  pickerHue = 0;
  private svDragging = false;
  /** Picker alpha (0–255) applied to the primary colour; 255 = opaque. */
  pickerAlpha = 255;
  /** Slider model shown in the colour picker. */
  pickerColorMode: 'hsv' | 'hsl' = 'hsv';
  /** Recently used drawing colours (most-recent first). */
  recentColors: string[] = [];
  brushSize = 1;
  /** Restrict drawing to the active palette's colours when on. */
  paletteLock = false;
  /** Dither brush: 'off' or fill ratio 25/50/75 (primary vs secondary). */
  ditherMode: 'off' | '25' | '50' | '75' = 'off';
  /** Seamless 3×3 tiled preview (in the Preview panel). */
  tiledPreview = false;
  /** Reference image overlay (not part of layers/export). */
  referenceImage: HTMLImageElement | null = null;
  referenceOpacity = 0.5;
  referenceVisible = true;
  referenceAbove = false;
  /** True when the reference is pixel-native (e.g. a .json export) — drawn crisp, no smoothing. */
  referencePixelExact = false;
  /** Gradient tool options. */
  gradientShape: 'linear' | 'radial' = 'linear';
  gradientDither = true;
  private gradientBase: Pixel[] | null = null;
  /** Shading ink: ramp + direction (-1 darker / +1 lighter) for the stroke. */
  private shadeRamp: string[] = [];
  private shadeDir = -1;
  /** Spray brush: the few palette shades around the primary, sampled at random. */
  private sprayColors: string[] = [];
  /** Spray density: fraction of cells in the brush radius painted per dab. */
  sprayDensity = 0.2;
  /** Spray clump size: value-noise cell size (bigger = larger, softer blobs). */
  sprayScatter = 4;
  /** Custom brush stamp captured from a selection (pen stamps it). */
  customBrush: { w: number; h: number; pixels: Pixel[] } | null = null;
  /** Procedural fill generator (Pixel Composer-style): writes patterns into the active layer. */
  genType: 'noise' | 'gradient' | 'checker' | 'bricks' | 'stipple' = 'noise';
  /** Feature / cell size in pixels (checker, bricks, noise lattice). */
  genScale = 4;
  /** Coverage / threshold 0–1 (noise, gradient, stipple). */
  genDensity = 0.5;
  genSeed = 1;
  /** Use the secondary colour as the second tone; off = leave it transparent. */
  genTwoColor = false;
  genGradientDir: 'h' | 'v' | 'd' = 'v';
  /** Clear the cells before generating; off = overlay on top of existing pixels. */
  genReplace = true;
  /** Animated VFX generator — builds a multi-frame effect in a new workspace tab. */
  vfxPreset: 'fire' | 'smoke' | 'sparkle' | 'explosion' | 'rain' = 'fire';
  vfxFrames = 8;
  vfxSeed = 1;
  /** Timelapse recording of the drawing process. */
  recording = false;
  timelapseFrames: HTMLCanvasElement[] = [];
  /** Hard cap on recorded frames (ring buffer drops the oldest beyond this). */
  static readonly MAX_TIMELAPSE_FRAMES = 900;
  readonly maxTimelapseFrames = EditorComponent.MAX_TIMELAPSE_FRAMES;
  /** True once the cap is hit this session — used to warn the user just once. */
  timelapseLimitHit = false;
  /** Pivot/anchor for sprite-sheet export (and on-canvas marker). */
  pivotPreset: 'center' | 'feet' | 'topleft' = 'feet';
  /** Sprite-sheet columns; 0 = auto (square-ish grid). */
  sheetColumns = 0;

  // ----- Tilemap editor -----
  tileSize = 16;
  tileMapCols = 16;
  tileMapRows = 12;
  /** On-screen pixels per map cell. */
  tilemapScale = 16;
  /** Map cells: index into the tileset, -1 = empty. Length = cols*rows. */
  tileMapCells: number[] = [];
  /** Selected tileset index to paint with (-1 = eraser). */
  selectedTile = 0;
  /** Auto-tiling: pick the tile variant from cardinal neighbours (16-tile blob). */
  tileMapAuto = false;
  /** Which map cells belong to the auto-tile group (parallel to tileMapCells). */
  private tileMapFilled: boolean[] = [];
  /** Data-URL thumbnails of each tile (for the palette). */
  tileThumbs: string[] = [];
  private tileSrcCanvas?: HTMLCanvasElement;
  private tilemapPainting = false;
  private tilemapErase = false;
  readonly builtinPalettes = BUILTIN_PALETTES;
  savedPalettes: NamedPalette[] = [];
  palette = [
    '#222831',
    '#393e46',
    '#00adb5',
    '#eeeeee',
    '#f05454',
    '#f9d923',
    '#7dce82',
    '#5c7cfa',
  ];

  frames: Frame[] = [this.createFrame('Frame 1')];
  activeFrameIndex = 0;
  activeLayerIndex = 0;
  private workspaceIdSeed = 2;
  workspaces: WorkspaceState[] = [this.captureWorkspace('Workspace 1', 1)];
  activeWorkspaceIndex = 0;
  frameThumbnails: string[] = [];

  private ctx!: CanvasRenderingContext2D;
  private displayCtx!: CanvasRenderingContext2D;
  /** Reused offscreen canvas for blend-mode compositing. */
  private blendScratch: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  } | null = null;
  private pointer: PointerState | null = null;
  private selection: Selection | null = null;
  private clipboard: Selection | null = null;
  private previewPixels: Pixel[] | null = null;
  private moveStartSelection: Selection | null = null;
  /** In-progress lasso polygon points (canvas pixel coords). */
  private lassoPoints: { x: number; y: number }[] = [];
  private lassoMode: 'replace' | 'add' | 'subtract' = 'replace';
  /** Brush stabilizer (lazy mouse): smooth jittery freehand strokes. */
  stabilizer = false;
  stabAmount = 0.5;
  private stabX = 0;
  private stabY = 0;
  /** Pixel-perfect stroke path + pre-stroke values (for corner removal). */
  private ppPath: { x: number; y: number }[] = [];
  private ppOriginal = new Map<number, Pixel>();
  /** Free-transform session for the current selection (scale / rotate / move). */
  private tf: {
    src: Pixel[];
    sw: number;
    sh: number;
    under: Pixel[];
    cx: number;
    cy: number;
    w: number;
    h: number;
    angle: number;
  } | null = null;
  private tfDrag: {
    mode: 'move' | 'scale' | 'rotate';
    handle: string;
    pointerId: number;
    startCx: number;
    startCy: number;
    startW: number;
    startH: number;
    startAngle: number;
    anchorX: number;
    anchorY: number;
    grabX: number;
    grabY: number;
  } | null = null;
  get isTransforming(): boolean {
    return !!this.tf;
  }
  get hasSelection(): boolean {
    return !!this.selection;
  }
  private panState: PanState | null = null;
  private paneResizeState: PaneResizeState | null = null;
  isSpacePanning = false;
  isPanning = false;
  isResizingPane = false;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private animationTimer?: number;
  isPlaying = false;
  previewFrameIndex = 0;
  loop = true;
  /** Playback speed; applying it sets every frame's duration. */
  fps = 12;
  /** Multi-frame selection (timeline). Always contains the active frame. */
  selectedFrames = new Set<number>([0]);
  private frameSelAnchor = 0;
  private frameDrag: { mode: 'select' | 'move'; start: number; moved: boolean } | null = null;
  frameDragOver = -1;
  /** When moving frames, whether the drop lands after (right of) the hovered frame. */
  frameDropAfter = false;
  /** Copied frames buffer for paste. */
  private copiedFrames: Frame[] = [];

  /** Animation tags (named frame ranges) for the active workspace. */
  tags: AnimTag[] = [];
  private tagIdSeed = 1;
  /** Tag scoped for playback / selection; null = play all frames. */
  activeTagId: number | null = null;
  /** Ping-pong playback direction (+1 / -1). */
  private playDirection = 1;
  /** Tag right-click context menu. */
  tagMenu: { x: number; y: number; id: number } | null = null;
  /** Group header right-click context menu. */
  groupMenu: { x: number; y: number; id: number } | null = null;
  private readonly tagColors = [
    '#e05a5a', '#e0a23a', '#3ab0e0', '#7d6ce0', '#3ac08a', '#d65ab0', '#9aa7b3',
  ];
  /** Frame tile geometry (must match .frame-tile width + .timeline gap in SCSS). */
  private readonly TILE_W = 64;
  private readonly TILE_GAP = 10;

  /** Layer folders (workspace-level); membership via Layer.groupId. */
  groups: LayerGroup[] = [];
  private groupIdSeed = 1;
  private readonly groupColors = [
    '#5b9ad6', '#d6975b', '#7bc06a', '#c06ab0', '#c0b06a', '#6ac0b0',
  ];
  /** Selectable layer blend modes. */
  readonly blendModes: { value: BlendMode; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'darken', label: 'Darken' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'add', label: 'Add' },
    { value: 'difference', label: 'Difference' },
  ];

  get activeFrame(): Frame {
    return this.frames[this.activeFrameIndex];
  }

  get activeLayer(): Layer {
    return (
      this.activeFrame.layers[this.activeLayerIndex] ??
      this.activeFrame.layers[0]
    );
  }

  get activeWorkspace(): WorkspaceState {
    return this.workspaces[this.activeWorkspaceIndex];
  }

  /** Pivot/anchor point in pixel coordinates from the active preset. */
  get pivotPoint(): { x: number; y: number } {
    switch (this.pivotPreset) {
      case 'center':
        return { x: this.width / 2, y: this.height / 2 };
      case 'topleft':
        return { x: 0, y: 0 };
      default:
        return { x: this.width / 2, y: this.height };
    }
  }

  setPivot(preset: 'center' | 'feet' | 'topleft'): void {
    this.pivotPreset = preset;
    this.render();
  }

  /** Width reserved for a side zone: 0 when empty (a thin strip while dragging). */
  private sideWidth(zone: Zone, width: number): number {
    if (!this.dock.zoneEmpty(zone)) return width;
    return this.dragActive ? 52 : 0;
  }

  get studioGridColumns(): string {
    const l = this.sideWidth('left', this.leftPanelWidth);
    const r = this.sideWidth('right', this.rightPanelWidth);
    return `${l}px ${l ? 6 : 0}px minmax(0, 1fr) ${r ? 6 : 0}px ${r}px`;
  }

  /** True when the bottom zone has panels but every one is collapsed. */
  get bottomAllCollapsed(): boolean {
    const ids = this.dock.state.zones.bottom;
    return ids.length > 0 && ids.every((id) => this.dock.isCollapsed(id));
  }

  get studioGridRows(): string {
    const empty = this.dock.zoneEmpty('bottom');
    if (empty) {
      const h = this.dragActive ? 44 : 0;
      return `minmax(0, 1fr) 0px ${h}px`;
    }
    // Collapsed panels only need header height; don't reserve full timeline space.
    if (this.bottomAllCollapsed) {
      return `minmax(0, 1fr) 0px auto`;
    }
    return `minmax(0, 1fr) 6px ${this.bottomPanelHeight}px`;
  }

  get showBottomResizer(): boolean {
    return !this.dock.zoneEmpty('bottom') && !this.bottomAllCollapsed;
  }

  onDragStarted(): void {
    this.dragActive = true;
  }

  onDragEnded(): void {
    this.dragActive = false;
    this.dropTargetZone = null;
  }

  get workspaceGridRows(): string {
    // tabs · topbar · selection-bar · canvas · statusbar
    return `auto auto auto minmax(0, 1fr) auto`;
  }

  get timelineVisible(): boolean {
    return true;
  }

  get timelineCollapsed(): boolean {
    return this.layersMinimized && this.framesMinimized;
  }

  get activePreviewFrameIndex(): number {
    return this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex;
  }

  get timelineLayerCount(): number {
    return this.frames.reduce(
      (max, frame) => Math.max(max, frame.layers.length),
      0,
    );
  }

  get timelineLayerIndices(): number[] {
    return Array.from({ length: this.timelineLayerCount }, (_, index) => index);
  }

  get canvasWidth(): number {
    return this.width * this.zoom;
  }

  get canvasHeight(): number {
    return this.height * this.zoom;
  }

  get displayCanvasWidth(): number {
    return this.width * this.displayZoom;
  }

  get displayCanvasHeight(): number {
    return this.height * this.displayZoom;
  }

  get selectionLabel(): string {
    return this.selection
      ? `${this.selection.w} x ${this.selection.h} at ${this.selection.x}, ${this.selection.y}`
      : 'None';
  }

  ngAfterViewInit(): void {
    // Canvas APIs are browser-only; skip during server-side rendering.
    if (!this.isBrowser) {
      return;
    }
    const ctx = this.stageRef.nativeElement.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas is not available.');
    }
    this.ctx = ctx;
    // Panel bodies live in <ng-template>s; collect them, then render once they
    // are projected into their dock zones. Defer a microtask to avoid a
    // change-after-checked warning in dev.
    Promise.resolve().then(() => {
      this.buildPanelTemplates();
      this.render();
    });
    this.panelDefs.changes.subscribe(() => this.buildPanelTemplates());
    this.render();
    // Restore the auto-saved project; fall back to the idle demo for newcomers.
    if (!this.restoreAutosave()) {
      void this.loadIdlePresetExample();
    }
  }

  ngAfterViewChecked(): void {
    if (!this.isBrowser) {
      return;
    }
    // The Display panel's canvas may mount/unmount as it is docked, floated or
    // closed. Re-bind its 2D context (and draw once) whenever the element changes.
    const el = this.displayRef?.nativeElement;
    if (el && el !== this.displayCanvasEl) {
      const dctx = el.getContext('2d');
      if (dctx) {
        this.displayCtx = dctx;
        this.displayCanvasEl = el;
        this.renderDisplay();
      }
    }
    // The Tilemap panel canvas mounts/unmounts the same way.
    const tel = this.tilemapRef?.nativeElement;
    if (tel && tel !== this.tilemapCanvasEl) {
      const tctx = tel.getContext('2d');
      if (tctx) {
        this.tilemapCtx = tctx;
        this.tilemapCanvasEl = tel;
        this.refreshTiles();
        this.renderTilemap();
      }
    }
    // Minimap canvas appears/disappears with zoom; bind + draw when it mounts.
    const mel = this.minimapRef?.nativeElement;
    if (mel && mel !== this.minimapEl) {
      const mctx = mel.getContext('2d');
      if (mctx) {
        this.minimapCtx = mctx;
        this.minimapEl = mel;
        this.drawMinimap();
      }
    }
  }

  private buildPanelTemplates(): void {
    const map = new Map<PanelId, TemplateRef<unknown>>();
    this.panelDefs.forEach((def) => map.set(def.id, def.template));
    this.panelTemplates = map;
  }

  // ---- dock / panel layout ------------------------------------------------

  templateFor(id: PanelId): TemplateRef<unknown> | null {
    return this.panelTemplates.get(id) ?? null;
  }

  /** Connected drop-list ids so panels can be dragged between zones. */
  get zoneListIds(): string[] {
    return this.zones.map((z) => 'zone-' + z);
  }

  onPanelDrop(event: CdkDragDrop<PanelId[]>, zone: Zone): void {
    if (event.previousContainer === event.container) {
      moveItemInArray(this.dock.state.zones[zone], event.previousIndex, event.currentIndex);
    } else {
      const fromZone = event.previousContainer.id.replace('zone-', '') as Zone;
      transferArrayItem(
        this.dock.state.zones[fromZone],
        this.dock.state.zones[zone],
        event.previousIndex,
        event.currentIndex,
      );
    }
    this.dock.save();
  }

  /** Tear a docked panel off into a floating window when dropped outside zones. */
  onDockedDragEnded(id: PanelId, event: { dropPoint: { x: number; y: number } }): void {
    const p = event.dropPoint;
    if (this.zoneAtPoint(p.x, p.y)) return; // dropped over a zone -> CDK handled it
    this.floatPanelAt(id, p.x, p.y);
  }

  private floatPanelAt(id: PanelId, clientX: number, clientY: number): void {
    // Coordinates are relative to the editor host (the .float-layer origin).
    const host = this.hostRef.nativeElement.getBoundingClientRect();
    const w = id === 'timeline' ? 420 : 260;
    const h = id === 'timeline' ? 240 : 220;
    const x = this.clamp(clientX - host.left - 40, 8, Math.max(8, host.width - w - 8));
    const y = this.clamp(clientY - host.top - 12, 8, Math.max(8, host.height - 60));
    this.dock.float(id, { x, y, w, h });
  }

  floatPanel(id: PanelId): void {
    const r = this.hostRef.nativeElement.getBoundingClientRect();
    this.floatPanelAt(id, r.left + r.width / 2, r.top + 120);
  }

  redock(id: PanelId): void {
    this.dock.dock(id, this.dock.zoneOf(id) ?? 'right');
  }

  resetLayout(): void {
    this.dock.reset();
  }

  togglePanelsMenu(): void {
    const open = !this.panelsMenuOpen;
    this.closeTopMenus();
    this.panelsMenuOpen = open;
  }

  // ---- floating window drag / resize (pointer based) ----------------------

  beginFloatDrag(event: PointerEvent, id: PanelId, mode: 'move' | 'resize'): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const f = this.dock.floatOf(id);
    if (!f) return;
    this.dock.bringToFront(id);
    // Capture on the element that received the pointerdown and listen for the
    // rest of the gesture ON THAT SAME element (pointer events are retargeted to
    // it while captured). Mixing capture with window listeners is what left the
    // drag stuck — the pointerup never reached the handler.
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.floatDrag = {
      id,
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startRect: { ...f.rect },
    };
    if (mode === 'move') this.dragActive = true;
  }

  onFloatMove(event: PointerEvent): void {
    if (!this.floatDrag || this.floatDrag.pointerId !== event.pointerId) return;
    const dx = event.clientX - this.floatDrag.startX;
    const dy = event.clientY - this.floatDrag.startY;
    const s = this.floatDrag.startRect;
    if (this.floatDrag.mode === 'move') {
      this.dock.setRect(this.floatDrag.id, { x: s.x + dx, y: s.y + dy });
      this.dropTargetZone = this.zoneAtPoint(event.clientX, event.clientY);
    } else {
      this.dock.setRect(this.floatDrag.id, {
        w: this.clamp(s.w + dx, 180, 720),
        h: this.clamp(s.h + dy, 120, 640),
      });
    }
  }

  /** End the float drag (pointerup / pointercancel / lostpointercapture). */
  onFloatEnd(event: PointerEvent): void {
    if (!this.floatDrag || this.floatDrag.pointerId !== event.pointerId) return;
    const drag = this.floatDrag;
    this.floatDrag = null;
    this.dragActive = false;
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture?.(
        event.pointerId,
      );
    } catch {
      /* capture may already be released */
    }
    if (drag.mode === 'move') {
      const zone = this.zoneAtPoint(event.clientX, event.clientY);
      this.dropTargetZone = null;
      if (zone) this.dock.dock(drag.id, zone);
      else this.dock.save();
    }
  }

  /** Which dock zone (if any) contains the given client point. */
  private zoneAtPoint(x: number, y: number): Zone | null {
    if (!this.zoneEls) return null;
    for (const ref of this.zoneEls) {
      const el = ref.nativeElement;
      const zone = el.dataset['zone'] as Zone | undefined;
      if (!zone) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zone;
    }
    return null;
  }

  addWorkspace(): void {
    this.saveCurrentWorkspace();
    const id = this.workspaceIdSeed;
    this.workspaceIdSeed += 1;
    const workspace = this.createBlankWorkspace(
      `Workspace ${this.nextWorkspaceNumber()}`,
      id,
    );
    this.workspaces.push(workspace);
    this.activeWorkspaceIndex = this.workspaces.length - 1;
    this.applyWorkspace(workspace);
  }

  /** Smallest positive integer N with no existing "Workspace N" tab — reuses gaps after a close. */
  private nextWorkspaceNumber(): number {
    const used = new Set<number>();
    for (const ws of this.workspaces) {
      const m = /^Workspace (\d+)$/.exec(ws.name);
      if (m) used.add(Number(m[1]));
    }
    let n = 1;
    while (used.has(n)) n += 1;
    return n;
  }

  duplicateWorkspace(): void {
    this.saveCurrentWorkspace();
    const id = this.workspaceIdSeed;
    this.workspaceIdSeed += 1;
    const copy = this.captureWorkspace(`${this.activeWorkspace.name} copy`, id);
    this.workspaces.splice(this.activeWorkspaceIndex + 1, 0, copy);
    this.activeWorkspaceIndex += 1;
    this.applyWorkspace(copy);
  }

  /** Load a small demo tree that shows off Multiply / Screen / Add blend layers. */
  loadBlendTreeExample(): void {
    this.fileMenuOpen = false;
    this.saveCurrentWorkspace();
    const id = this.workspaceIdSeed;
    this.workspaceIdSeed += 1;
    const workspace = this.buildBlendTree(id);
    this.workspaces.push(workspace);
    this.activeWorkspaceIndex = this.workspaces.length - 1;
    this.applyWorkspace(workspace);
  }

  /** Load a stylised conifer/bush tree on a grassy mound (from a reference). */
  loadBushTreeExample(): void {
    this.fileMenuOpen = false;
    this.saveCurrentWorkspace();
    const id = this.workspaceIdSeed;
    this.workspaceIdSeed += 1;
    const workspace = this.buildBushTree(id);
    this.workspaces.push(workspace);
    this.activeWorkspaceIndex = this.workspaces.length - 1;
    this.applyWorkspace(workspace);
  }

  private buildBushTree(id: number): WorkspaceState {
    const W = 32;
    const H = 40;
    const cx = 16;
    const px = new Array<Pixel>(W * H).fill(null);
    const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
    const set = (x: number, y: number, c: string) => {
      if (inB(x, y)) px[y * W + x] = c;
    };
    const get = (x: number, y: number) => (inB(x, y) ? px[y * W + x] : null);
    const ellipse = (
      ecx: number,
      ecy: number,
      rx: number,
      ry: number,
      c: string,
      pred?: (x: number, y: number) => boolean,
    ) => {
      for (let y = Math.ceil(ecy - ry); y <= Math.floor(ecy + ry); y += 1) {
        for (let x = Math.ceil(ecx - rx); x <= Math.floor(ecx + rx); x += 1) {
          const dx = (x - ecx) / rx;
          const dy = (y - ecy) / ry;
          if (dx * dx + dy * dy <= 1 && (!pred || pred(x, y))) set(x, y, c);
        }
      }
    };

    const C = {
      out: '#16331c', // dark outline
      dk: '#2e6233', // shadow green
      md: '#4f9a3f', // base green
      lt: '#82c64f', // highlight
      gout: '#1f4a22',
      gdk: '#3f7a2e',
      gmd: '#6fb83e',
      glt: '#9bd45c',
      tout: '#241712',
      tdk: '#4a2e22',
      tmd: '#6b4632',
      tlt: '#8a5a40',
    };

    // Grassy mound at the base.
    ellipse(cx, 34, 11, 5, C.gout);
    ellipse(cx, 34, 10, 4, C.gdk);
    ellipse(cx, 33, 9, 3.4, C.gmd);
    ellipse(cx - 2, 32, 5, 2, C.glt);

    // Teardrop crown: half-width per row (pointed top, round bottom).
    const hw = [
      1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 10, 11, 11, 11, 11,
      10, 10, 9, 8, 6,
    ];
    const top = 4;
    for (let i = 0; i < hw.length; i += 1) {
      const y = top + i;
      for (let x = cx - hw[i]; x <= cx + hw[i]; x += 1) set(x, y, C.md);
    }
    // Lower-right shading.
    for (let i = 0; i < hw.length; i += 1) {
      const y = top + i;
      for (let x = cx - hw[i]; x <= cx + hw[i]; x += 1) {
        if (get(x, y) === C.md && x - cx + (y - 14) > 7) set(x, y, C.dk);
      }
    }
    // Soft highlight blobs (upper-left) + a few scattered leaves.
    [
      [12, 9, 2, 1],
      [10, 13, 3, 2],
      [13, 16, 2, 1],
      [9, 19, 3, 2],
      [14, 22, 3, 1],
      [11, 25, 2, 1],
      [19, 14, 2, 1],
      [20, 20, 2, 1],
    ].forEach(([bx, by, rx, ry]) => ellipse(bx, by, rx, ry, C.lt));
    // Dark texture cuts.
    [
      [15, 12],
      [17, 18],
      [13, 21],
      [18, 24],
      [10, 16],
    ].forEach(([bx, by]) => {
      set(bx, by, C.dk);
      set(bx + 1, by, C.dk);
    });

    // Crown outline: any green pixel touching empty/grass gets the dark border.
    const greens = new Set([C.md, C.dk, C.lt]);
    const snap = px.slice();
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const c = snap[y * W + x];
        if (!c || !greens.has(c)) continue;
        for (const [nx, ny] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ]) {
          const nc = inB(nx, ny) ? snap[ny * W + nx] : null;
          if (!nc || (!greens.has(nc) && nc !== C.out)) set(nx, ny, C.out);
        }
      }
    }

    // Trunk hollow (knot) at the base, sitting on the mound.
    ellipse(cx, 30, 5, 4, C.tout);
    ellipse(cx, 30, 4, 3, C.tdk);
    ellipse(cx, 31, 3, 2, C.tmd);
    ellipse(cx - 1, 31, 1.6, 1, C.tlt);

    const frame: Frame = {
      name: 'Frame 1',
      duration: 160,
      visible: true,
      layers: [
        {
          name: 'Tree',
          visible: true,
          locked: false,
          opacity: 1,
          blend: 'normal',
          groupId: null,
          pixels: px,
        },
      ],
    };
    return {
      id,
      name: 'Bush tree',
      width: W,
      height: H,
      frames: [frame],
      tags: [],
      groups: [],
      activeFrameIndex: 0,
      activeLayerIndex: 0,
      palette: [
        C.out, C.dk, C.md, C.lt, C.gout, C.gdk, C.gmd, C.glt,
        C.tout, C.tdk, C.tmd, C.tlt,
      ],
      primaryColor: C.md,
      secondaryColor: C.out,
      view: { ...this.defaultView(), zoom: 8, displayZoom: 6 },
    };
  }

  private buildBlendTree(id: number): WorkspaceState {
    const W = 32;
    const H = 32;
    const N = W * H;
    const idx = (x: number, y: number) => y * W + x;
    const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
    const blank = () => new Array<Pixel>(N).fill(null);
    const set = (buf: Pixel[], x: number, y: number, c: string) => {
      if (inB(x, y)) buf[idx(x, y)] = c;
    };
    const rect = (
      buf: Pixel[],
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      c: string,
    ) => {
      for (let y = y0; y <= y1; y += 1)
        for (let x = x0; x <= x1; x += 1) set(buf, x, y, c);
    };
    const disc = (
      buf: Pixel[],
      cx: number,
      cy: number,
      r: number,
      c: string,
      pred?: (x: number, y: number) => boolean,
    ) => {
      for (let y = cy - r; y <= cy + r; y += 1)
        for (let x = cx - r; x <= cx + r; x += 1) {
          const dx = x - cx;
          const dy = y - cy;
          if (dx * dx + dy * dy <= r * r && (!pred || pred(x, y)))
            set(buf, x, y, c);
        }
    };

    const cx = 16;
    const cy = 13;
    const r = 10;

    // Base layer: green crown + brown trunk (Normal).
    const base = blank();
    rect(base, 14, 21, 17, 30, '#6b4a2b');
    disc(base, cx, cy, r, '#3e8948');

    // Shadow layer (Multiply): lower-right of the crown + right of the trunk.
    const shadow = blank();
    disc(shadow, cx, cy, r, '#9a8fc0', (x, y) => x + y > cx + cy + 2);
    rect(shadow, 16, 21, 17, 30, '#9a8fc0');

    // Highlight layer (Screen): top-left rim of the crown.
    const highlight = blank();
    disc(highlight, cx, cy, r, '#fff2c0', (x, y) => x + y < cx + cy - 8);

    // Glow layer (Add): a few bright sparkles where the light hits hardest.
    const glow = blank();
    for (const [x, y] of [
      [11, 6],
      [12, 6],
      [11, 7],
      [13, 5],
    ]) {
      set(glow, x, y, '#bfffa0');
    }

    const gid = 1;
    const layer = (
      name: string,
      pixels: Pixel[],
      blend: BlendMode,
      opacity: number,
      groupId: number | null,
    ): Layer => ({
      name,
      visible: true,
      locked: false,
      opacity,
      blend,
      groupId,
      pixels,
    });

    const frame: Frame = {
      name: 'Frame 1',
      duration: 160,
      visible: true,
      layers: [
        layer('Base', base, 'normal', 1, null),
        layer('Shadow ×', shadow, 'multiply', 0.75, gid),
        layer('Highlight', highlight, 'screen', 0.9, gid),
        layer('Glow +', glow, 'add', 1, gid),
      ],
    };

    return {
      id,
      name: 'Tree example',
      width: W,
      height: H,
      frames: [frame],
      tags: [],
      groups: [
        {
          id: gid,
          name: 'Shading',
          visible: true,
          locked: false,
          collapsed: false,
          opacity: 1,
          color: this.groupColors[0],
        },
      ],
      activeFrameIndex: 0,
      activeLayerIndex: 1,
      palette: [
        '#3e8948', '#265c42', '#6b4a2b', '#9a8fc0', '#fff2c0', '#bfffa0',
        '#ffffff', '#1a1530',
      ],
      primaryColor: '#9a8fc0',
      secondaryColor: '#fff2c0',
      view: { ...this.defaultView(), zoom: 8, displayZoom: 6 },
    };
  }

  selectWorkspace(index: number): void {
    if (index === this.activeWorkspaceIndex) {
      return;
    }
    this.flushAdjust();
    this.saveCurrentWorkspace();
    this.activeWorkspaceIndex = index;
    this.applyWorkspace(this.activeWorkspace);
  }

  closeWorkspace(index: number, event?: MouseEvent): void {
    event?.stopPropagation();
    if (this.workspaces.length === 1) {
      this.newSprite();
      this.saveCurrentWorkspace();
      return;
    }
    this.saveCurrentWorkspace();
    this.workspaces.splice(index, 1);
    this.activeWorkspaceIndex = Math.min(
      this.activeWorkspaceIndex,
      this.workspaces.length - 1,
    );
    this.applyWorkspace(this.activeWorkspace);
  }

  renameActiveWorkspace(name: string): void {
    this.activeWorkspace.name = name.trim() || 'Untitled';
  }

  async loadIdlePresetExample(): Promise<void> {
    try {
      const frameCount = 8;
      const targetWidth = 96;
      const targetHeight = 128;
      const frames: Frame[] = [];
      const colors = new Map<string, number>();
      const cacheBust = Date.now();
      const idleImages = await Promise.all(
        Array.from({ length: frameCount }, (_, i) =>
          this.loadImageUrl(
            `assets/idle-frames/idle_${String(i + 1).padStart(2, '0')}.png?v=${cacheBust}`,
          ),
        ),
      );

      this.width = targetWidth;
      this.height = targetHeight;
      this.importPaletteSize = 42;
      this.importDither = true;
      this.importSharpen = 0.45;
      this.importContrast = 1.12;
      this.importFit = 'contain';

      for (let i = 0; i < frameCount; i += 1) {
        const sampled = this.sampleImage(
          idleImages[i],
          targetWidth,
          targetHeight,
          {
            transparentWhite: true,
          },
        );
        sampled.palette.forEach((color) =>
          colors.set(color, (colors.get(color) ?? 0) + 1),
        );
        frames.push({
          name: `Idle ${String(i + 1).padStart(2, '0')}`,
          duration: 140,
          visible: true,
          layers: [
            {
              name: 'Character',
              visible: true,
              opacity: 1,
              pixels: sampled.pixels,
            },
          ],
        });
      }

      this.frames = frames;
      this.activeFrameIndex = 0;
      this.previewFrameIndex = 0;
      this.activeLayerIndex = 0;
      this.palette = [
        '#ffe7d6',
        '#ffcdb8',
        '#ff6b6b',
        '#7a1e1e',
        '#1e1b2e',
        '#302d44',
        '#5e5873',
        '#ffffff',
        '#f8e9e6',
        '#b71c1c',
        '#8e0e0e',
        '#ff3b3b',
        '#ffd54f',
        '#d4ac0d',
        '#8b6f00',
        '#9e9e9e',
        '#fff1f1',
        '#ffb3b3',
        '#ff4646',
        ...[...colors.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([color]) => color),
      ]
        .filter((color, index, list) => list.indexOf(color) === index)
        .slice(0, 32);
      this.primaryColor = '#1e1b2e';
      this.secondaryColor = '#ff4646';
      this.activeWorkspaceIndex = 0;
      this.workspaces[0] = this.captureWorkspace(
        'Kitsune Idle Example',
        this.workspaces[0].id,
      );
      this.refreshAllFrameThumbnails();
      this.render();
    } catch {
      this.render();
    }
  }

  loadTreeExample(): void {
    const nextWidth = 96;
    const nextHeight = 96;
    const pixelCount = nextWidth * nextHeight;
    const shadow = new Array<Pixel>(pixelCount).fill(null);
    const ground = new Array<Pixel>(pixelCount).fill(null);
    const trunk = new Array<Pixel>(pixelCount).fill(null);
    const leaves = new Array<Pixel>(pixelCount).fill(null);
    const colors = {
      outline: '#102326',
      shadow: '#1b211a',

      barkBlack: '#1e100d',
      barkDark: '#3a1713',
      barkShadow: '#502216',
      barkRed: '#642918',
      barkRust: '#7b3519',
      barkMid: '#9b4f1c',
      barkOrange: '#c06f24',
      barkGold: '#df9b32',
      barkLight: '#f2c75a',

      rootGreen: '#1b6b35',

      rockBlack: '#24251f',
      rockDark: '#45483d',
      rockShadow: '#5f6353',
      rockMid: '#7b806d',
      rockWarm: '#91866b',
      rockLight: '#c1c2a2',

      leafBlack: '#0d2b2f',
      leafBlueShadow: '#123f48',
      leafDeep: '#173f2b',
      leafDeep2: '#1d5230',
      leafDark: '#286432',
      leafMoss: '#39742f',
      leafMid: '#4f8830',
      leafOlive: '#6f9d32',
      leafBright: '#88ad35',
      leafGold: '#a4bd3f',
      leafLight: '#bdd35d',

      rimDark: '#1d6f7a',
      rim: '#38aebe',
      rimLight: '#67d5df',
    };
    const index = (x: number, y: number) => y * nextWidth + x;
    const inside = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < nextWidth && y < nextHeight;
    const put = (buffer: Pixel[], x: number, y: number, color: Pixel) => {
      if (inside(x, y)) {
        buffer[index(x, y)] = color;
      }
    };
    const fillEllipse = (
      buffer: Pixel[],
      cx: number,
      cy: number,
      rx: number,
      ry: number,
      color: Pixel,
    ) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
          const dx = (x - cx) / rx;
          const dy = (y - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            put(buffer, x, y, color);
          }
        }
      }
    };
    const drawLine = (
      buffer: Pixel[],
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      color: Pixel,
      thickness = 1,
    ) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let i = 0; i <= steps; i += 1) {
        const x = Math.round(x0 + (x1 - x0) * (i / Math.max(1, steps)));
        const y = Math.round(y0 + (y1 - y0) * (i / Math.max(1, steps)));
        for (let oy = 0; oy < thickness; oy += 1) {
          for (let ox = 0; ox < thickness; ox += 1) {
            put(buffer, x + ox, y + oy, color);
          }
        }
      }
    };
    const fillRect = (
      buffer: Pixel[],
      x: number,
      y: number,
      w: number,
      h: number,
      color: Pixel,
    ) => {
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          put(buffer, xx, yy, color);
        }
      }
    };
    const pixelBlocks = (
      buffer: Pixel[],
      blocks: [number, number, number, number, Pixel][],
    ) => {
      blocks.forEach(([x, y, w, h, color]) =>
        fillRect(buffer, x, y, w, h, color),
      );
    };

    this.width = nextWidth;
    this.height = nextHeight;

    const createPixelSharpness = (): Pixel[] => {
      const sharp = new Array<Pixel>(pixelCount).fill(null);

      pixelBlocks(sharp, [
        // leaf crisp highlights
        [20, 15, 3, 2, colors.leafLight],
        [28, 13, 4, 2, colors.leafLight],
        [44, 31, 5, 2, colors.leafLight],
        [52, 34, 4, 2, colors.leafGold],
        [35, 41, 5, 2, colors.leafBright],

        // deep cuts inside canopy
        [13, 35, 5, 3, colors.leafBlack],
        [31, 56, 6, 3, colors.leafBlack],
        [80, 42, 5, 3, colors.leafBlack],
        [70, 63, 5, 3, colors.leafDeep],

        // cyan rim accents
        [83, 48, 2, 8, colors.rim],
        [86, 54, 2, 7, colors.rimLight],
        [64, 58, 8, 2, colors.rim],
        [73, 61, 6, 2, colors.rimLight],

        // trunk sharper lights
        [47, 50, 4, 1, colors.barkLight],
        [43, 72, 4, 2, colors.barkGold],
        [24, 77, 6, 2, colors.barkLight],
        [62, 77, 9, 2, colors.barkOrange],

        // trunk dark cracks
        [53, 56, 2, 6, colors.barkBlack],
        [57, 66, 2, 7, colors.barkBlack],
        [72, 76, 10, 2, colors.barkBlack],
      ]);

      return sharp;
    };

    fillEllipse(shadow, 48, 83, 37, 7, colors.shadow);
    fillEllipse(shadow, 32, 80, 18, 4, colors.shadow);
    fillEllipse(shadow, 69, 80, 21, 4, colors.shadow);
    pixelBlocks(shadow, [
      [16, 82, 10, 3, colors.outline],
      [27, 84, 20, 4, colors.outline],
      [50, 85, 24, 4, colors.outline],
      [73, 82, 18, 3, colors.outline],
      [22, 88, 7, 2, colors.shadow],
      [62, 89, 10, 2, colors.shadow],
    ]);

    [
      [18, 77, 9, 6],
      [29, 82, 8, 7],
      [44, 83, 9, 7],
      [58, 83, 8, 6],
      [73, 81, 11, 6],
      [86, 80, 6, 5],
      [24, 86, 5, 3],
      [67, 87, 5, 3],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(ground, cx, cy, rx, ry, colors.rockBlack),
    );
    [
      [17, 78, 8, 5],
      [28, 83, 7, 6],
      [43, 84, 8, 6],
      [58, 84, 7, 5],
      [73, 82, 10, 5],
      [86, 81, 5, 4],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(ground, cx, cy, rx, ry, colors.rockDark),
    );
    [
      [18, 76, 7, 4],
      [30, 81, 6, 5],
      [45, 82, 7, 5],
      [60, 82, 6, 4],
      [74, 80, 8, 4],
      [87, 79, 4, 3],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(ground, cx, cy, rx, ry, colors.rockMid),
    );
    [
      [17, 74, 3, 2],
      [31, 78, 4, 2],
      [43, 79, 4, 2],
      [61, 79, 3, 2],
      [74, 77, 4, 2],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(ground, cx, cy, rx, ry, colors.rockLight),
    );
    pixelBlocks(ground, [
      [13, 81, 6, 3, colors.rockShadow],
      [20, 78, 4, 2, colors.rockWarm],
      [24, 84, 6, 3, colors.rockBlack],
      [31, 83, 5, 3, colors.rockLight],
      [37, 86, 6, 3, colors.rockDark],
      [45, 84, 5, 3, colors.rockShadow],
      [51, 86, 5, 3, colors.rockLight],
      [63, 83, 6, 3, colors.rockDark],
      [70, 82, 8, 3, colors.rockLight],
      [78, 84, 7, 3, colors.rockShadow],
      [87, 80, 5, 3, colors.rockDark],
    ]);
    [
      [12, 83],
      [27, 88],
      [50, 87],
      [79, 85],
      [91, 82],
    ].forEach(([x, y]) => fillRect(ground, x, y, 3, 3, colors.rootGreen));

    [
      [44, 38, 53, 51, 6],
      [50, 48, 59, 63, 7],
      [58, 61, 57, 76, 7],
      [43, 51, 36, 63, 6],
      [37, 62, 27, 74, 5],
      [52, 72, 42, 84, 6],
      [56, 72, 70, 81, 5],
      [47, 73, 21, 79, 4],
      [57, 76, 85, 78, 4],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.outline, size),
    );
    [
      [45, 39, 53, 51, 4],
      [51, 49, 58, 63, 5],
      [56, 62, 56, 75, 5],
      [43, 52, 37, 63, 4],
      [37, 64, 29, 73, 3],
      [52, 73, 43, 83, 4],
      [56, 73, 70, 80, 3],
      [47, 75, 22, 79, 3],
      [57, 77, 84, 78, 3],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkDark, size),
    );
    [
      [48, 40, 55, 53, 3],
      [54, 52, 61, 65, 4],
      [57, 65, 53, 77, 3],
      [39, 54, 34, 64, 3],
      [55, 73, 72, 81, 2],
      [33, 73, 21, 78, 2],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkShadow, size),
    );
    [
      [43, 42, 51, 52, 2],
      [48, 55, 55, 64, 2],
      [45, 72, 38, 80, 3],
      [52, 75, 27, 79, 2],
      [58, 77, 77, 78, 2],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkRust, size),
    );
    [
      [45, 43, 50, 51, 2],
      [50, 51, 55, 62, 3],
      [36, 65, 28, 73, 2],
      [44, 77, 34, 83, 2],
      [48, 75, 42, 83, 2],
      [51, 74, 24, 79, 2],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkMid, size),
    );
    [
      [44, 51, 50, 52, 2],
      [47, 68, 43, 76, 2],
      [30, 72, 24, 78, 2],
      [48, 75, 42, 81, 2],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkGold, size),
    );
    [
      [48, 50, 52, 51, 1],
      [44, 73, 40, 77, 1],
      [27, 76, 23, 78, 1],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkLight, size),
    );
    [
      [60, 48, 66, 38, 3],
      [42, 45, 33, 35, 3],
      [50, 42, 50, 31, 2],
      [39, 50, 25, 45, 2],
    ].forEach(([x0, y0, x1, y1, size]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkDark, size),
    );
    [
      [61, 49, 67, 39, 1],
      [42, 46, 34, 36, 1],
      [51, 42, 51, 32, 1],
    ].forEach(([x0, y0, x1, y1]) =>
      drawLine(trunk, x0, y0, x1, y1, colors.barkMid, 1),
    );
    pixelBlocks(trunk, [
      [44, 47, 4, 3, colors.barkRed],
      [52, 56, 5, 4, colors.barkBlack],
      [47, 62, 6, 3, colors.barkOrange],
      [54, 67, 5, 6, colors.barkBlack],
      [37, 75, 7, 4, colors.barkGold],
      [24, 78, 8, 3, colors.barkLight],
      [62, 78, 10, 3, colors.barkRed],
      [71, 76, 12, 2, colors.barkBlack],
    ]);
    drawLine(trunk, 61, 53, 63, 66, colors.rimDark, 1);
    drawLine(trunk, 58, 66, 59, 76, colors.rim, 1);
    drawLine(trunk, 72, 77, 85, 77, colors.rim, 1);
    drawLine(trunk, 82, 76, 89, 79, colors.rimDark, 1);

    [
      [24, 29, 18, 13],
      [36, 22, 20, 15],
      [51, 22, 23, 16],
      [68, 27, 20, 14],
      [77, 39, 18, 13],
      [28, 43, 23, 15],
      [48, 40, 25, 17],
      [64, 45, 22, 15],
      [82, 53, 15, 13],
      [38, 55, 22, 13],
      [57, 55, 22, 14],
      [72, 59, 17, 12],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafBlack),
    );
    [
      [22, 28, 16, 11],
      [35, 20, 17, 12],
      [51, 22, 20, 13],
      [67, 28, 17, 12],
      [76, 40, 15, 11],
      [27, 42, 20, 13],
      [47, 39, 22, 15],
      [63, 45, 19, 13],
      [81, 53, 12, 10],
      [37, 55, 19, 11],
      [57, 54, 19, 12],
      [72, 58, 14, 10],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafDeep),
    );
    [
      [15, 30, 8, 7],
      [26, 17, 10, 8],
      [43, 14, 12, 7],
      [60, 18, 10, 8],
      [74, 31, 9, 8],
      [20, 48, 12, 8],
      [50, 47, 14, 8],
      [68, 55, 11, 8],
      [82, 58, 8, 7],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafBlueShadow),
    );
    [
      [23, 31, 11, 7],
      [36, 23, 12, 8],
      [52, 26, 12, 8],
      [68, 31, 10, 8],
      [31, 47, 14, 8],
      [48, 46, 14, 9],
      [62, 50, 12, 8],
      [76, 51, 9, 7],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafDeep2),
    );
    [
      [22, 25, 11, 8],
      [34, 18, 12, 9],
      [47, 20, 15, 10],
      [62, 25, 13, 9],
      [29, 40, 16, 9],
      [44, 36, 17, 11],
      [61, 43, 14, 10],
      [76, 51, 10, 8],
      [38, 53, 14, 8],
      [55, 52, 14, 9],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafDark),
    );
    [
      [18, 22, 7, 5],
      [31, 17, 9, 6],
      [40, 27, 8, 6],
      [50, 33, 11, 7],
      [58, 22, 8, 5],
      [25, 38, 10, 6],
      [37, 43, 9, 7],
      [58, 42, 9, 6],
      [70, 35, 8, 5],
      [31, 54, 8, 5],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafMid),
    );
    [
      [20, 25, 5, 4],
      [28, 27, 6, 4],
      [37, 19, 6, 4],
      [46, 25, 8, 5],
      [56, 27, 6, 4],
      [64, 36, 6, 4],
      [23, 46, 8, 5],
      [44, 41, 8, 5],
      [59, 48, 6, 4],
      [72, 47, 5, 4],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafMoss),
    );
    [
      [17, 20, 5, 3],
      [25, 17, 5, 4],
      [35, 28, 5, 3],
      [45, 35, 7, 4],
      [54, 34, 5, 3],
      [28, 40, 6, 4],
      [38, 48, 5, 3],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafOlive),
    );
    [
      [18, 18, 5, 4],
      [28, 15, 6, 4],
      [37, 24, 5, 4],
      [44, 32, 8, 5],
      [52, 31, 6, 4],
      [25, 36, 5, 3],
      [34, 40, 5, 4],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafBright),
    );
    [
      [17, 16, 3, 2],
      [25, 13, 4, 2],
      [42, 31, 4, 2],
      [49, 34, 3, 2],
      [31, 39, 3, 2],
    ].forEach(([cx, cy, rx, ry]) =>
      fillEllipse(leaves, cx, cy, rx, ry, colors.leafLight),
    );
    pixelBlocks(leaves, [
      [12, 24, 5, 4, colors.leafDeep],
      [16, 17, 4, 3, colors.leafGold],
      [21, 14, 4, 4, colors.leafLight],
      [27, 12, 5, 3, colors.leafBright],
      [32, 16, 6, 4, colors.leafGold],
      [39, 20, 5, 4, colors.leafMoss],
      [45, 29, 8, 5, colors.leafLight],
      [53, 32, 6, 4, colors.leafGold],
      [59, 23, 8, 4, colors.leafDark],
      [66, 27, 5, 5, colors.leafMoss],
      [74, 36, 6, 5, colors.leafDeep],
      [80, 43, 5, 4, colors.leafBlack],
      [18, 38, 8, 4, colors.leafOlive],
      [25, 43, 7, 5, colors.leafDeep2],
      [34, 40, 8, 5, colors.leafBright],
      [43, 43, 7, 6, colors.leafDark],
      [52, 44, 8, 5, colors.leafDeep2],
      [61, 45, 7, 5, colors.leafMoss],
      [71, 49, 6, 5, colors.leafDeep],
      [79, 55, 5, 5, colors.leafBlueShadow],
      [26, 55, 9, 5, colors.leafDeep],
      [37, 57, 9, 4, colors.leafBlack],
      [50, 58, 8, 5, colors.leafDeep],
      [62, 60, 8, 5, colors.leafBlueShadow],
      [72, 63, 7, 4, colors.leafDeep],
    ]);
    [
      [84, 44, 88, 52],
      [73, 55, 84, 57],
      [63, 55, 70, 55],
      [76, 63, 83, 65],
      [57, 59, 62, 61],
      [41, 57, 46, 58],
    ].forEach(([x0, y0, x1, y1]) =>
      drawLine(leaves, x0, y0, x1, y1, colors.rim, 1),
    );
    [
      [84, 47, 90, 55],
      [74, 60, 86, 62],
      [65, 60, 72, 61],
      [78, 66, 85, 68],
    ].forEach(([x0, y0, x1, y1]) =>
      drawLine(leaves, x0, y0, x1, y1, colors.rimLight, 1),
    );
    pixelBlocks(leaves, [
      [16, 40, 3, 3, colors.leafDeep2],
      [20, 50, 3, 3, colors.leafDeep],
      [33, 31, 3, 3, colors.leafMoss],
      [46, 23, 3, 3, colors.leafDark],
      [56, 36, 3, 3, colors.leafMoss],
      [70, 30, 3, 3, colors.leafDeep2],
      [82, 40, 3, 3, colors.leafBlueShadow],
      [85, 56, 3, 3, colors.leafDeep],
      [71, 63, 3, 3, colors.leafDeep],
      [49, 61, 3, 3, colors.leafBlack],
      [28, 57, 3, 3, colors.leafDeep],
      [13, 31, 3, 3, colors.leafDeep2],
    ]);
    [
      [11, 35],
      [18, 14],
      [31, 8],
      [47, 9],
      [66, 14],
      [82, 29],
      [92, 50],
      [76, 69],
      [55, 66],
      [34, 67],
      [14, 53],
      [7, 39],
    ].forEach(([x, y]) => fillRect(leaves, x, y, 4, 4, colors.leafBlack));
    pixelBlocks(trunk, [
      [39, 66, 8, 6, colors.barkDark],
      [44, 65, 5, 5, colors.barkGold],
      [51, 68, 8, 6, colors.barkShadow],
      [62, 70, 17, 5, colors.barkDark],
      [69, 72, 16, 3, colors.barkRed],
      [32, 69, 8, 4, colors.barkMid],
      [36, 72, 8, 4, colors.barkGold],
    ]);

    const frameTotal = 12;

    const windStep = (frameIndex: number) => {
      const steps = [0, 1, 2, 1, 0, -1, -2, -1, 0, 1, 1, 0];
      return steps[frameIndex % steps.length];
    };

    const copyRegion = (
      source: Pixel[],
      target: Pixel[],
      x: number,
      y: number,
      w: number,
      h: number,
      dx: number,
      dy: number,
    ) => {
      for (let yy = y; yy < y + h; yy += 1) {
        for (let xx = x; xx < x + w; xx += 1) {
          if (!inside(xx, yy)) continue;

          const color = source[index(xx, yy)];
          if (!color) continue;

          const tx = xx + dx;
          const ty = yy + dy;

          if (inside(tx, ty)) {
            target[index(tx, ty)] = color;
          }
        }
      }
    };

    const createWeightedLeaves = (frameIndex: number): Pixel[] => {
      const result = new Array<Pixel>(pixelCount).fill(null);

      const w = windStep(frameIndex);
      const slow = windStep((frameIndex + 2) % frameTotal);
      const delayed = windStep((frameIndex + 4) % frameTotal);

      // lõi tán gần thân: gần như đứng yên
      copyRegion(leaves, result, 24, 30, 46, 38, 0, 0);

      // đỉnh cây: rung rõ hơn
      copyRegion(leaves, result, 15, 8, 58, 24, w, w === 2 ? -1 : 0);

      // mép trái: nhẹ hơn
      copyRegion(
        leaves,
        result,
        5,
        22,
        34,
        42,
        slow > 0 ? 1 : slow < 0 ? -1 : 0,
        0,
      );

      // mép phải: rõ nhất để thấy gió
      copyRegion(leaves, result, 62, 22, 31, 48, w, 0);

      // phần dưới tán nặng, chỉ nhích nhẹ
      copyRegion(
        leaves,
        result,
        20,
        52,
        66,
        22,
        delayed > 0 ? 1 : delayed < 0 ? -1 : 0,
        0,
      );

      return result;
    };

    const createOuterWindSilhouette = (frameIndex: number): Pixel[] => {
      const overlay = new Array<Pixel>(pixelCount).fill(null);
      const w = windStep(frameIndex);

      const dxRight = w > 0 ? 1 : w < 0 ? -1 : 0;
      const dxStrong = w > 0 ? 2 : w < 0 ? -2 : 0;

      // mép phải tán cây — giúp gió rõ hơn
      pixelBlocks(overlay, [
        [86 + dxStrong, 28, 4, 9, colors.leafBlack],
        [89 + dxStrong, 38, 4, 10, colors.leafDeep],
        [90 + dxStrong, 49, 3, 12, colors.leafBlack],
        [84 + dxRight, 60, 5, 6, colors.leafDeep2],

        // mép trái chuyển động nhẹ
        [7 + dxRight, 35, 4, 9, colors.leafBlack],
        [9 + dxRight, 48, 5, 8, colors.leafDeep],

        // đỉnh cây rung nhẹ
        [31 + dxRight, 8, 5, 4, colors.leafBlack],
        [47 + dxRight, 9, 4, 4, colors.leafDeep],
      ]);

      return overlay;
    };

    const createBetterLeafTexture = (): Pixel[] => {
      const tex = new Array<Pixel>(pixelCount).fill(null);

      pixelBlocks(tex, [
        // phá các mảng vàng lớn bằng mid-tone
        [24, 17, 6, 3, colors.leafBright],
        [31, 22, 7, 3, colors.leafMid],
        [44, 33, 8, 3, colors.leafGold],
        [55, 35, 8, 3, colors.leafBright],
        [35, 41, 7, 3, colors.leafMid],

        // highlight nhỏ, không tạo mảng trắng lớn
        [19, 15, 3, 2, colors.leafLight],
        [27, 13, 4, 2, colors.leafGold],
        [47, 31, 5, 2, colors.leafLight],
        [54, 33, 4, 2, colors.leafGold],

        // cut shadow để tán sắc hơn
        [13, 35, 5, 3, colors.leafBlack],
        [30, 56, 6, 3, colors.leafBlack],
        [79, 42, 5, 3, colors.leafBlack],
        [70, 63, 5, 3, colors.leafDeep],

        // rim xanh nhưng giảm diện tích
        [84, 48, 2, 7, colors.rim],
        [87, 55, 2, 6, colors.rimLight],
        [65, 58, 7, 2, colors.rim],
        [74, 61, 5, 2, colors.rimLight],
      ]);

      return tex;
    };

    const createMovingBranches = (frameIndex: number): Pixel[] => {
      const overlay = new Array<Pixel>(pixelCount).fill(null);
      const w = windStep(frameIndex);
      const tip = w > 0 ? 1 : w < 0 ? -1 : 0;

      drawLine(overlay, 60, 48, 66 + tip, 38, colors.barkDark, 2);
      drawLine(overlay, 42, 45, 33 + tip, 35, colors.barkDark, 2);
      drawLine(overlay, 50, 42, 50 + tip, 31, colors.barkRust, 1);
      drawLine(overlay, 39, 50, 25 + tip, 45, colors.barkMid, 1);

      return overlay;
    };

    const animatedFrames = Array.from(
      { length: frameTotal },
      (_, frameIndex): Frame => ({
        name: `Ancient Tree Clear Wind ${frameIndex + 1}`,
        duration: 95,
        visible: true,
        layers: [
          { name: 'Shadow', visible: true, opacity: 0.55, pixels: [...shadow] },
          { name: 'Rocks', visible: true, opacity: 1, pixels: [...ground] },
          {
            name: 'Stable trunk and roots',
            visible: true,
            opacity: 1,
            pixels: [...trunk],
          },
          {
            name: 'Moving branches',
            visible: true,
            opacity: 1,
            pixels: createMovingBranches(frameIndex),
          },
          {
            name: 'Weighted leaf canopy',
            visible: true,
            opacity: 1,
            pixels: createWeightedLeaves(frameIndex),
          },
          {
            name: 'Outer wind silhouette',
            visible: true,
            opacity: 1,
            pixels: createOuterWindSilhouette(frameIndex),
          },
          {
            name: 'Better leaf texture',
            visible: true,
            opacity: 1,
            pixels: createBetterLeafTexture(),
          },
        ],
      }),
    );
    this.frames = animatedFrames;
    this.activeFrameIndex = 0;
    this.previewFrameIndex = 0;
    this.activeLayerIndex = 4;
    this.selection = null;
    this.previewPixels = null;
    this.moveStartSelection = null;
    this.palette = Object.values(colors);
    this.primaryColor = colors.leafBright;
    this.secondaryColor = colors.barkMid;
    this.zoom = 8;
    this.displayZoom = 3;
    if (this.isPlaying) {
      window.clearTimeout(this.animationTimer);
    }
    this.isPlaying = true;
    this.workspaces[this.activeWorkspaceIndex] = this.captureWorkspace(
      'Tree Example',
      this.workspaces[this.activeWorkspaceIndex]?.id ?? 1,
    );
    this.refreshAllFrameThumbnails();
    this.render();
    this.playNextFrame();
  }

  private extractSpriteFromSheet(
    image: HTMLImageElement,
    rect: SourceRect,
  ): { canvas: HTMLCanvasElement; bounds: PixelBounds } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.w);
    canvas.height = Math.round(rect.h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      image,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.removeWhiteBackground(imageData);
    ctx.putImageData(imageData, 0, 0);
    return {
      canvas,
      bounds: this.findLargestOpaqueBounds(imageData) ?? {
        x: 0,
        y: 0,
        w: canvas.width,
        h: canvas.height,
      },
    };
  }

  private sampleAlignedSpriteFrame(
    sourceCanvas: HTMLCanvasElement,
    bounds: PixelBounds,
    width: number,
    height: number,
    scale: number,
  ): { pixels: Pixel[]; palette: string[] } {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    const drawWidth = Math.round(bounds.w * scale);
    const drawHeight = Math.round(bounds.h * scale);
    const drawX = Math.round((width - drawWidth) / 2);
    const drawY = Math.round(height - drawHeight - 7);
    ctx.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.w,
      bounds.h,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
    const imageData = ctx.getImageData(0, 0, width, height);
    this.enhanceImageData(imageData, width, height);
    return this.imageDataToPixels(imageData, width, height);
  }

  private findLargestOpaqueBounds(imageData: ImageData): PixelBounds | null {
    const width = imageData.width;
    const height = imageData.height;
    const visited = new Uint8Array(width * height);
    let best: (PixelBounds & { area: number }) | null = null;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const start = y * width + x;
        if (visited[start] || imageData.data[start * 4 + 3] < 20) {
          continue;
        }
        const queue = [{ x, y }];
        visited[start] = 1;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let area = 0;

        while (queue.length) {
          const point = queue.shift()!;
          area += 1;
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);

          const neighbors = [
            { x: point.x + 1, y: point.y },
            { x: point.x - 1, y: point.y },
            { x: point.x, y: point.y + 1 },
            { x: point.x, y: point.y - 1 },
          ];
          for (const neighbor of neighbors) {
            if (
              neighbor.x < 0 ||
              neighbor.y < 0 ||
              neighbor.x >= width ||
              neighbor.y >= height
            ) {
              continue;
            }
            const index = neighbor.y * width + neighbor.x;
            if (visited[index] || imageData.data[index * 4 + 3] < 20) {
              continue;
            }
            visited[index] = 1;
            queue.push(neighbor);
          }
        }

        if (!best || area > best.area) {
          best = {
            x: minX,
            y: minY,
            w: maxX - minX + 1,
            h: maxY - minY + 1,
            area,
          };
        }
      }
    }

    return best;
  }

  setSymmetry(mode: SymmetryMode): void {
    this.symmetry = mode;
    this.render();
  }

  setTool(tool: Tool): void {
    // Leaving the transform tool bakes any in-progress transform.
    if (this.activeTool === 'transform' && tool !== 'transform' && this.tf) {
      this.commitTransform();
    }
    this.activeTool = tool;
    if (tool !== 'move') {
      this.previewPixels = null;
    }
    this.lassoPoints = [];
    // Entering transform with a selection lifts it immediately so handles show.
    if (tool === 'transform' && this.selection && !this.tf) {
      this.beginTransform();
    }
    this.render();
  }

  newSprite(): void {
    this.pushUndo();
    this.width = this.clamp(Math.floor(this.width), 8, 128);
    this.height = this.clamp(Math.floor(this.height), 8, 128);
    this.frames = [this.createFrame('Frame 1')];
    this.tags = [];
    this.activeTagId = null;
    this.groups = [];
    this.activeFrameIndex = 0;
    this.activeLayerIndex = 0;
    this.selection = null;
    this.render();
  }

  addLayer(): void {
    this.pushUndo();
    const name = `Layer ${this.timelineLayerCount + 1}`;
    // Insert above the active layer, inside the same group it belongs to.
    const at = this.activeLayerIndex + 1;
    const groupId = this.layerGroupId(this.activeLayerIndex);
    for (const frame of this.frames) {
      frame.layers.splice(at, 0, this.createLayer(name, groupId));
    }
    this.activeLayerIndex = at;
    this.render();
  }

  duplicateLayer(): void {
    this.pushUndo();
    for (const frame of this.frames) {
      const source =
        frame.layers[this.activeLayerIndex] ??
        this.createLayer(`Layer ${this.activeLayerIndex + 1}`);
      frame.layers.splice(this.activeLayerIndex + 1, 0, {
        ...source,
        name: `${source.name} copy`,
        locked: source.locked ?? false,
        pixels: [...source.pixels],
      });
    }
    this.activeLayerIndex += 1;
    this.render();
  }

  deleteLayer(): void {
    if (this.timelineLayerCount === 1) {
      this.clearLayer();
      return;
    }
    this.pushUndo();
    for (const frame of this.frames) {
      if (frame.layers[this.activeLayerIndex]) {
        frame.layers.splice(this.activeLayerIndex, 1);
      }
    }
    this.activeLayerIndex = Math.max(0, this.activeLayerIndex - 1);
    this.render();
  }

  /** Reset the multi-selection to just the active frame. */
  private syncFrameSelection(): void {
    this.selectedFrames = new Set<number>([this.activeFrameIndex]);
    this.frameSelAnchor = this.activeFrameIndex;
  }

  addFrame(): void {
    this.pushUndo();
    this.shiftTagsForInsert(this.activeFrameIndex + 1, 1);
    this.frames.splice(
      this.activeFrameIndex + 1,
      0,
      this.createFrame(`Frame ${this.frames.length + 1}`),
    );
    this.activeFrameIndex += 1;
    this.activeLayerIndex = 0;
    this.syncFrameSelection();
    this.refreshAllFrameThumbnails();
    this.render();
  }

  duplicateFrame(): void {
    this.pushUndo();
    const copy = this.cloneFrame(
      this.activeFrame,
      `${this.activeFrame.name} copy`,
    );
    this.shiftTagsForInsert(this.activeFrameIndex + 1, 1);
    this.frames.splice(this.activeFrameIndex + 1, 0, copy);
    this.activeFrameIndex += 1;
    this.syncFrameSelection();
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Delete the selected frame(s), always keeping at least one. */
  deleteFrame(): void {
    if (this.frames.length === 1) {
      this.clearLayer();
      return;
    }
    const del = [...this.selectedFrames].sort((a, b) => a - b);
    // Never delete every frame.
    while (del.length >= this.frames.length) del.pop();
    if (!del.length) del.push(this.activeFrameIndex);
    this.pushUndo();
    const delSet = new Set(del);
    this.shiftTagsForDelete(del);
    this.frames = this.frames.filter((_, i) => !delSet.has(i));
    this.activeFrameIndex = this.clamp(del[0], 0, this.frames.length - 1);
    this.activeLayerIndex = Math.min(
      this.activeLayerIndex,
      this.activeFrame.layers.length - 1,
    );
    this.previewFrameIndex = this.activeFrameIndex;
    this.syncFrameSelection();
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Insert a blank frame before or after the active one. */
  insertFrame(after: boolean): void {
    this.pushUndo();
    const at = this.activeFrameIndex + (after ? 1 : 0);
    this.shiftTagsForInsert(at, 1);
    this.frames.splice(at, 0, this.createFrame(`Frame ${this.frames.length + 1}`));
    this.activeFrameIndex = at;
    this.previewFrameIndex = at;
    this.activeLayerIndex = 0;
    this.syncFrameSelection();
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Reverse the order of all frames (e.g. to ping-pong an animation). */
  reverseFrames(): void {
    if (this.frames.length < 2) {
      return;
    }
    this.pushUndo();
    const n = this.frames.length;
    for (const t of this.tags) {
      const from = n - 1 - t.to;
      const to = n - 1 - t.from;
      t.from = from;
      t.to = to;
    }
    this.frames.reverse();
    this.activeFrameIndex = this.frames.length - 1 - this.activeFrameIndex;
    this.previewFrameIndex = this.activeFrameIndex;
    this.syncFrameSelection();
    this.refreshAllFrameThumbnails();
    this.render();
  }

  clearLayer(): void {
    if (this.activeLayerLocked) return;
    this.pushUndo();
    this.activeLayer.pixels.fill(null);
    this.selection = null;
    this.render();
  }

  // ===================== Procedural fill generator =====================

  randomizeGenSeed(): void {
    this.genSeed = Math.floor(Math.random() * 100000);
  }

  /** Generate the selected pattern into the active layer (selection-aware, undoable). */
  applyGenerator(): void {
    if (this.activeLayerLocked) return;
    this.pushUndo();
    const px = this.activeLayer.pixels;
    if (this.genReplace) {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          if (this.inActiveSelection(x, y)) px[this.index(x, y)] = null;
        }
      }
    }
    const primary = this.lockColor(this.primaryColor);
    const second: Pixel = this.genTwoColor
      ? this.lockColor(this.secondaryColor)
      : null;
    const rng = this.makeRng(this.genSeed);
    const scale = Math.max(1, Math.round(this.genScale));
    const density = this.clamp(this.genDensity, 0, 1);
    switch (this.genType) {
      case 'noise':
        this.genNoise(px, primary, second, scale, density, rng);
        break;
      case 'gradient':
        this.genGradient(px, primary, second, density);
        break;
      case 'checker':
        this.genChecker(px, primary, second, scale);
        break;
      case 'bricks':
        this.genBricks(px, primary, second, scale);
        break;
      case 'stipple':
        this.genStipple(px, primary, second, density, rng);
        break;
    }
    this.refreshActiveFrameThumbnail();
    this.render();
  }

  private putGen(px: Pixel[], x: number, y: number, color: Pixel): void {
    // A null tone means "leave it" — keeps the layer transparent there.
    if (color === null) return;
    if (!this.inActiveSelection(x, y)) return;
    px[this.index(x, y)] = color;
  }

  /** Smooth value noise thresholded into primary/second tones. */
  private genNoise(
    px: Pixel[],
    primary: Pixel,
    second: Pixel,
    scale: number,
    density: number,
    rng: () => number,
  ): void {
    const gw = Math.ceil(this.width / scale) + 2;
    const gh = Math.ceil(this.height / scale) + 2;
    const lattice = new Array<number>(gw * gh);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const gx = x / scale;
        const gy = y / scale;
        const x0 = Math.floor(gx);
        const y0 = Math.floor(gy);
        const fx = smooth(gx - x0);
        const fy = smooth(gy - y0);
        const v00 = lattice[y0 * gw + x0];
        const v10 = lattice[y0 * gw + x0 + 1];
        const v01 = lattice[(y0 + 1) * gw + x0];
        const v11 = lattice[(y0 + 1) * gw + x0 + 1];
        const top = v00 + (v10 - v00) * fx;
        const bot = v01 + (v11 - v01) * fx;
        const v = top + (bot - top) * fy;
        this.putGen(px, x, y, v >= 1 - density ? primary : second);
      }
    }
  }

  /** Ordered (Bayer) dithered gradient along the chosen axis. */
  private genGradient(
    px: Pixel[],
    primary: Pixel,
    second: Pixel,
    density: number,
  ): void {
    const bayer = EditorComponent.BAYER4;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let t: number;
        if (this.genGradientDir === 'h') {
          t = x / Math.max(1, this.width - 1);
        } else if (this.genGradientDir === 'v') {
          t = y / Math.max(1, this.height - 1);
        } else {
          t = (x + y) / Math.max(1, this.width + this.height - 2);
        }
        const level = this.clamp(t + (density - 0.5), 0, 1);
        const threshold = (bayer[y & 3][x & 3] + 0.5) / 16;
        this.putGen(px, x, y, level > threshold ? primary : second);
      }
    }
  }

  private genChecker(
    px: Pixel[],
    primary: Pixel,
    second: Pixel,
    scale: number,
  ): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const cell = (Math.floor(x / scale) + Math.floor(y / scale)) & 1;
        this.putGen(px, x, y, cell ? second : primary);
      }
    }
  }

  private genBricks(
    px: Pixel[],
    primary: Pixel,
    second: Pixel,
    scale: number,
  ): void {
    const bh = Math.max(2, scale);
    const bw = Math.max(2, scale * 2);
    for (let y = 0; y < this.height; y += 1) {
      const row = Math.floor(y / bh);
      const offset = row & 1 ? Math.floor(bw / 2) : 0;
      const mortarRow = y % bh === 0;
      for (let x = 0; x < this.width; x += 1) {
        const mortarCol = (x + offset) % bw === 0;
        this.putGen(px, x, y, mortarRow || mortarCol ? second : primary);
      }
    }
  }

  private genStipple(
    px: Pixel[],
    primary: Pixel,
    second: Pixel,
    density: number,
    rng: () => number,
  ): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        this.putGen(px, x, y, rng() < density ? primary : second);
      }
    }
  }

  /** True when (x,y) is inside the active selection (or there's no selection). */
  private inActiveSelection(x: number, y: number): boolean {
    const sel = this.selection;
    if (!sel) return true;
    if (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h) {
      return false;
    }
    if (sel.mask) return sel.mask[(y - sel.y) * sel.w + (x - sel.x)] !== false;
    return true;
  }

  /** Deterministic PRNG (mulberry32) so a given seed always reproduces a pattern. */
  private makeRng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===================== Animated VFX generator =====================

  randomizeVfxSeed(): void {
    this.vfxSeed = Math.floor(Math.random() * 100000);
  }

  private static readonly VFX_LABELS: Record<string, string> = {
    fire: 'Fire',
    smoke: 'Smoke',
    sparkle: 'Sparkle',
    explosion: 'Explosion',
    rain: 'Rain',
  };

  /** Build the chosen looping effect as a fresh workspace tab (non-destructive). */
  generateVfx(): void {
    this.saveCurrentWorkspace();
    const id = this.workspaceIdSeed;
    this.workspaceIdSeed += 1;
    const workspace = this.buildVfxWorkspace(
      id,
      this.vfxPreset,
      this.clamp(Math.round(this.vfxFrames), 2, 24),
      this.vfxSeed,
    );
    this.workspaces.push(workspace);
    this.activeWorkspaceIndex = this.workspaces.length - 1;
    this.applyWorkspace(workspace);
  }

  private buildVfxWorkspace(
    id: number,
    preset: EditorComponent['vfxPreset'],
    frameCount: number,
    seed: number,
  ): WorkspaceState {
    const W = this.width;
    const H = this.height;
    const rng = this.makeRng(seed);
    const scale = Math.max(2, Math.round(Math.min(W, H) / 10));
    const periodCells = 8;
    const noise =
      preset === 'fire' || preset === 'smoke'
        ? this.makeTileNoiseY(W, scale, periodCells, rng)
        : null;
    // Per-preset particle state, fixed for the whole loop so it animates coherently.
    const sparkles: { x: number; y: number; birth: number; life: number }[] = [];
    if (preset === 'sparkle') {
      const n = Math.max(6, Math.floor((W * H) / 90));
      for (let i = 0; i < n; i += 1) {
        sparkles.push({
          x: Math.floor(rng() * W),
          y: Math.floor(rng() * H),
          birth: rng(),
          life: 0.2 + rng() * 0.4,
        });
      }
    }
    const drops: { x: number; speed: number; phase: number; len: number }[] = [];
    if (preset === 'rain') {
      const n = Math.max(8, Math.floor(W / 2));
      for (let i = 0; i < n; i += 1) {
        drops.push({
          x: Math.floor(rng() * W),
          speed: 0.7 + rng() * 0.9,
          phase: rng(),
          len: 2 + Math.floor(rng() * 3),
        });
      }
    }
    const frames: Frame[] = [];
    for (let f = 0; f < frameCount; f += 1) {
      const t = f / frameCount; // 0..1 loop phase
      const px = new Array<Pixel>(W * H).fill(null);
      switch (preset) {
        case 'fire':
          this.vfxFire(px, W, H, t, scale, periodCells, noise!);
          break;
        case 'smoke':
          this.vfxSmoke(px, W, H, t, scale, periodCells, noise!);
          break;
        case 'sparkle':
          this.vfxSparkle(px, W, H, t, sparkles);
          break;
        case 'explosion':
          this.vfxExplosion(px, W, H, t);
          break;
        case 'rain':
          this.vfxRain(px, W, H, t, drops);
          break;
      }
      frames.push({
        name: `Frame ${f + 1}`,
        duration: 80,
        visible: true,
        layers: [
          {
            name: EditorComponent.VFX_LABELS[preset],
            visible: true,
            locked: false,
            opacity: 1,
            blend: 'normal',
            groupId: null,
            pixels: px,
          },
        ],
      });
    }
    return {
      id,
      name: `VFX ${EditorComponent.VFX_LABELS[preset]}`,
      width: W,
      height: H,
      frames,
      tags: [],
      groups: [],
      activeFrameIndex: 0,
      activeLayerIndex: 0,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      view: this.defaultView(),
    };
  }

  /** Value noise that tiles vertically (period = periodCells·scale px) for seamless loops. */
  private makeTileNoiseY(
    width: number,
    scale: number,
    periodCells: number,
    rng: () => number,
  ): (x: number, y: number) => number {
    const gw = Math.ceil(width / scale) + 2;
    const gh = periodCells;
    const lattice = new Array<number>(gw * gh);
    for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();
    const smooth = (v: number) => v * v * (3 - 2 * v);
    return (x: number, y: number) => {
      const gx = x / scale;
      const gy = y / scale;
      const x0 = Math.min(gw - 2, Math.floor(gx));
      const y0 = Math.floor(gy);
      const fx = smooth(gx - x0);
      const fy = smooth(gy - y0);
      const ya = ((y0 % gh) + gh) % gh;
      const yb = (ya + 1) % gh;
      const v00 = lattice[ya * gw + x0];
      const v10 = lattice[ya * gw + x0 + 1];
      const v01 = lattice[yb * gw + x0];
      const v11 = lattice[yb * gw + x0 + 1];
      const top = v00 + (v10 - v00) * fx;
      const bot = v01 + (v11 - v01) * fx;
      return top + (bot - top) * fy;
    };
  }

  private rampColor(ramp: string[], v: number): Pixel {
    if (v <= 0) return null;
    const i = Math.min(ramp.length - 1, Math.floor(v * ramp.length));
    return ramp[i];
  }

  private vfxFire(
    px: Pixel[],
    W: number,
    H: number,
    t: number,
    scale: number,
    periodCells: number,
    noise: (x: number, y: number) => number,
  ): void {
    const ramp = ['#5a1606', '#9e2b0e', '#d6481a', '#f47b1f', '#ffb43a', '#ffe57a', '#fff4c2'];
    const dy = t * periodCells * scale; // full period over the loop → seamless
    for (let y = 0; y < H; y += 1) {
      const base = H > 1 ? y / (H - 1) : 1; // 0 top → 1 bottom (hot)
      for (let x = 0; x < W; x += 1) {
        const n = noise(x, y + dy);
        const v = this.clamp(n * 1.5 - (1 - base) * 1.05, 0, 1);
        const c = this.rampColor(ramp, v <= 0.08 ? 0 : v);
        if (c) px[y * W + x] = c;
      }
    }
  }

  private vfxSmoke(
    px: Pixel[],
    W: number,
    H: number,
    t: number,
    scale: number,
    periodCells: number,
    noise: (x: number, y: number) => number,
  ): void {
    const ramp = ['#3a3a40', '#55555e', '#74747f', '#9596a1', '#b9bac4'];
    const dy = t * periodCells * scale;
    for (let y = 0; y < H; y += 1) {
      const top = H > 1 ? 1 - y / (H - 1) : 0; // 1 at top (thinning)
      for (let x = 0; x < W; x += 1) {
        const n = noise(x, y + dy);
        const v = this.clamp(n * 1.25 - top * 0.7, 0, 1);
        const c = this.rampColor(ramp, v <= 0.12 ? 0 : v);
        if (c) px[y * W + x] = c;
      }
    }
  }

  private vfxSparkle(
    px: Pixel[],
    W: number,
    H: number,
    t: number,
    sparkles: { x: number; y: number; birth: number; life: number }[],
  ): void {
    const ramp = ['#fff7c2', '#ffffff'];
    const put = (x: number, y: number, c: Pixel) => {
      if (x >= 0 && y >= 0 && x < W && y < H && c) px[y * W + x] = c;
    };
    for (const s of sparkles) {
      const phase = ((t - s.birth + 1) % 1) / s.life;
      if (phase < 0 || phase > 1) continue;
      const grow = Math.sin(phase * Math.PI); // 0 → 1 → 0
      if (grow <= 0.05) continue;
      const arm = Math.round(grow * 2.2);
      const c = grow > 0.6 ? ramp[1] : ramp[0];
      put(s.x, s.y, ramp[1]);
      for (let r = 1; r <= arm; r += 1) {
        put(s.x + r, s.y, c);
        put(s.x - r, s.y, c);
        put(s.x, s.y + r, c);
        put(s.x, s.y - r, c);
      }
    }
  }

  private vfxExplosion(px: Pixel[], W: number, H: number, t: number): void {
    const ramp = ['#5a1606', '#9e2b0e', '#d6481a', '#f47b1f', '#ffb43a', '#ffe57a', '#fff4c2'];
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    const maxR = Math.min(W, H) / 2 - 1;
    const radius = t * maxR * 1.15;
    const thickness = 1.5 + (1 - t) * 3;
    const fade = 1 - t * 0.65;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        const d = Math.hypot(x - cx, y - cy);
        const shell = Math.abs(d - radius);
        if (shell > thickness) continue;
        const v = this.clamp((1 - shell / thickness) * fade, 0, 1);
        const c = this.rampColor(ramp, v <= 0.1 ? 0 : v);
        if (c) px[y * W + x] = c;
      }
    }
  }

  private vfxRain(
    px: Pixel[],
    W: number,
    H: number,
    t: number,
    drops: { x: number; speed: number; phase: number; len: number }[],
  ): void {
    const ramp = ['#9fc7ff', '#d6ecff'];
    for (const drop of drops) {
      const head = Math.floor((((drop.phase + t * drop.speed) % 1) + 1) % 1 * H);
      for (let i = 0; i < drop.len; i += 1) {
        const y = head - i;
        if (y < 0 || y >= H || drop.x < 0 || drop.x >= W) continue;
        px[y * W + drop.x] = i === 0 ? ramp[1] : ramp[0];
      }
    }
  }

  togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    if (!this.isPlaying) {
      window.clearTimeout(this.animationTimer);
      this.previewFrameIndex = this.activeFrameIndex;
      this.render();
      return;
    }
    const tag = this.playingTag;
    if (tag) {
      this.playDirection = tag.direction === 'reverse' ? -1 : 1;
      this.previewFrameIndex = this.clamp(
        tag.direction === 'reverse' ? tag.to : tag.from,
        tag.from,
        tag.to,
      );
    }
    this.playNextFrame();
  }

  onPointerDown(event: PointerEvent): void {
    // Working on the canvas drops any multi-frame selection back to the active frame.
    this.collapseFrameSelection();
    if (this.shouldPanCanvas(event)) {
      this.beginPan(event);
      return;
    }
    // Drawing bakes any pending adjustment first, so strokes land on adjusted pixels.
    this.flushAdjust();
    // Free-transform handles can sit outside the pixel grid, so handle it before
    // the in-bounds point check below.
    if (this.activeTool === 'transform') {
      if (!this.tf && this.selection) this.beginTransform();
      if (this.tf) this.transformPointerDown(event);
      return;
    }
    const point =
      this.activeTool === 'move' && this.selection && this.previewPixels
        ? this.eventToCanvasPixel(event)
        : this.eventToPixel(event);
    if (!point) {
      return;
    }

    // Picker is read-only and works on any layer (no pointer state needed).
    if (this.activeTool === 'picker') {
      const color = this.compositeAt(point.x, point.y);
      if (color) {
        this.applyPickedColor(color, event.button === 2 || event.altKey);
      }
      return;
    }

    // Selection tools are non-destructive — allowed even on a locked layer.
    if (this.activeTool === 'wand') {
      this.selectByWand(point.x, point.y, event.shiftKey, event.altKey);
      this.render();
      return;
    }
    if (this.activeTool === 'lasso') {
      this.stageRef.nativeElement.setPointerCapture(event.pointerId);
      this.pointer = { ...point, startX: point.x, startY: point.y };
      this.lassoMode = event.shiftKey ? 'add' : event.altKey ? 'subtract' : 'replace';
      this.lassoPoints = [point];
      this.render();
      return;
    }

    // Locked layer: block all editing, including drag-painting. Don't capture
    // the pointer or set pointer state, so pointermove/up do nothing either.
    if (this.activeLayerLocked) {
      return;
    }

    this.stageRef.nativeElement.setPointerCapture(event.pointerId);
    this.pointer = { ...point, startX: point.x, startY: point.y };

    this.pushUndo();
    if (
      this.activeTool === 'pen' ||
      this.activeTool === 'fill' ||
      this.activeTool === 'gradient' ||
      this.activeTool === 'line' ||
      this.activeTool === 'rect' ||
      this.activeTool === 'ellipse'
    ) {
      this.pushRecent(this.primaryColor);
    }
    if (this.activeTool === 'pen' || this.activeTool === 'eraser') {
      this.resetPixelPerfect();
      this.stabX = point.x;
      this.stabY = point.y;
      this.strokeTo(point.x, point.y);
    } else if (this.activeTool === 'fill') {
      this.fillMirrored(point.x, point.y, this.effectivePrimary);
    } else if (this.activeTool === 'gradient') {
      this.gradientBase = [...this.activeLayer.pixels];
      this.previewPixels = [...this.gradientBase];
    } else if (this.activeTool === 'shade') {
      this.shadeDir = event.button === 2 || event.altKey ? 1 : -1;
      this.shadeRamp = this.buildShadeRamp();
      this.shadeAt(point.x, point.y);
    } else if (this.activeTool === 'spray') {
      this.sprayColors = this.buildSprayColors();
      this.sprayAt(point.x, point.y);
    } else if (this.activeTool === 'select') {
      this.selection = { x: point.x, y: point.y, w: 1, h: 1, pixels: [] };
    } else if (this.activeTool === 'move' && this.selection) {
      this.previewPixels = [...this.activeLayer.pixels];
      this.moveStartSelection = {
        ...this.selection,
        pixels: [...this.selection.pixels],
      };
    }
    this.render();
  }

  onCanvasWrapPointerDown(event: PointerEvent): void {
    if (
      event.target === this.canvasWrapRef.nativeElement ||
      event.button === 1
    ) {
      this.beginPan(event);
    }
  }

  onCanvasWrapPointerMove(event: PointerEvent): void {
    if (!this.panState) {
      return;
    }
    const wrap = this.canvasWrapRef.nativeElement;
    wrap.scrollLeft =
      this.panState.scrollLeft - (event.clientX - this.panState.clientX);
    wrap.scrollTop =
      this.panState.scrollTop - (event.clientY - this.panState.clientY);
  }

  onCanvasWrapPointerUp(event: PointerEvent): void {
    if (!this.panState || this.panState.pointerId !== event.pointerId) {
      return;
    }
    this.panState = null;
    this.isPanning = false;
  }

  onCanvasWheel(event: WheelEvent): void {
    if (!event.ctrlKey) {
      return;
    }
    event.preventDefault();
    const previousZoom = this.zoom;
    this.zoom = this.clamp(this.zoom + (event.deltaY < 0 ? 1 : -1), this.minZoom, this.maxZoom);
    if (this.zoom === previousZoom) {
      return;
    }
    this.render();
  }

  /** Fit the sprite to the visible canvas area. */
  fitToScreen(): void {
    const wrap = this.canvasWrapRef?.nativeElement;
    if (!wrap) return;
    const pad = 64;
    const zw = Math.floor((wrap.clientWidth - pad) / this.width);
    const zh = Math.floor((wrap.clientHeight - pad) / this.height);
    this.zoom = this.clamp(Math.min(zw, zh), this.minZoom, this.maxZoom);
    this.render();
  }

  beginPaneResize(event: PointerEvent, pane: ResizePane): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.paneResizeState = {
      pane,
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startLeftWidth: this.leftPanelWidth,
      startRightWidth: this.rightPanelWidth,
      startBottomHeight: this.bottomPanelHeight,
    };
    this.isResizingPane = true;
  }

  resizePane(event: PointerEvent): void {
    if (
      !this.paneResizeState ||
      this.paneResizeState.pointerId !== event.pointerId
    ) {
      return;
    }
    const dx = event.clientX - this.paneResizeState.clientX;
    if (this.paneResizeState.pane === 'left') {
      this.leftPanelWidth = this.clamp(
        this.paneResizeState.startLeftWidth + dx,
        150,
        360,
      );
    } else if (this.paneResizeState.pane === 'right') {
      this.rightPanelWidth = this.clamp(
        this.paneResizeState.startRightWidth - dx,
        240,
        520,
      );
    } else {
      const dy = event.clientY - this.paneResizeState.clientY;
      this.bottomPanelHeight = this.clamp(
        this.paneResizeState.startBottomHeight - dy,
        120,
        420,
      );
    }
  }

  endPaneResize(event: PointerEvent): void {
    if (
      !this.paneResizeState ||
      this.paneResizeState.pointerId !== event.pointerId
    ) {
      return;
    }
    this.paneResizeState = null;
    this.isResizingPane = false;
  }

  toggleLayersMinimized(): void {
    this.layersMinimized = !this.layersMinimized;
  }

  toggleFramesMinimized(): void {
    this.framesMinimized = !this.framesMinimized;
  }

  onDisplayPointerDown(event: PointerEvent): void {
    if (!this.displayRef) return;
    const rect = this.displayRef.nativeElement.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / this.displayZoom);
    const y = Math.floor((event.clientY - rect.top) / this.displayZoom);
    if (!this.inside(x, y)) {
      return;
    }
    const color = this.compositeAt(x, y);
    if (color) {
      this.applyPickedColor(color, event.button === 2 || event.altKey);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (this.activeTool === 'transform') {
      this.transformPointerMove(event);
      return;
    }
    if (!this.pointer) {
      return;
    }
    const point = this.eventToPixel(event);
    if (!point) {
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'eraser') {
      let tx = point.x;
      let ty = point.y;
      if (this.stabilizer) {
        // Lazy mouse: the pen trails the cursor, smoothing out jitter.
        const k = 1 - this.clamp(this.stabAmount, 0, 0.92);
        this.stabX += (point.x - this.stabX) * k;
        this.stabY += (point.y - this.stabY) * k;
        tx = Math.round(this.stabX);
        ty = Math.round(this.stabY);
      }
      this.drawLine(this.pointer.x, this.pointer.y, tx, ty, (x, y) =>
        this.strokeTo(x, y),
      );
      this.pointer.x = tx;
      this.pointer.y = ty;
    } else if (this.activeTool === 'shade') {
      this.drawLine(this.pointer.x, this.pointer.y, point.x, point.y, (x, y) =>
        this.shadeAt(x, y),
      );
      this.pointer.x = point.x;
      this.pointer.y = point.y;
    } else if (this.activeTool === 'spray') {
      this.drawLine(this.pointer.x, this.pointer.y, point.x, point.y, (x, y) =>
        this.sprayAt(x, y),
      );
      this.pointer.x = point.x;
      this.pointer.y = point.y;
    } else if (this.activeTool === 'gradient' && this.gradientBase) {
      this.previewPixels = [...this.gradientBase];
      this.applyGradient(
        this.previewPixels,
        this.pointer.startX,
        this.pointer.startY,
        point.x,
        point.y,
      );
    } else if (this.activeTool === 'select') {
      this.selection = this.rectFromPoints(
        this.pointer.startX,
        this.pointer.startY,
        point.x,
        point.y,
      );
    } else if (
      this.activeTool === 'move' &&
      this.selection &&
      this.previewPixels
    ) {
      const dx = point.x - this.pointer.startX;
      const dy = point.y - this.pointer.startY;
      this.moveSelectionPreview(dx, dy);
    } else if (this.activeTool === 'lasso') {
      const last = this.lassoPoints[this.lassoPoints.length - 1];
      if (!last || last.x !== point.x || last.y !== point.y) {
        this.lassoPoints.push(point);
      }
    } else if (['line', 'rect', 'ellipse'].includes(this.activeTool)) {
      this.previewPixels = [...this.activeLayer.pixels];
      this.drawShape(
        this.previewPixels,
        this.pointer.startX,
        this.pointer.startY,
        point.x,
        point.y,
        this.activeTool,
      );
    }
    this.render();
  }

  onPointerUp(event: PointerEvent): void {
    if (this.activeTool === 'transform') {
      this.transformPointerUp(event);
      return;
    }
    if (!this.pointer) {
      return;
    }
    const point = this.eventToPixel(event) ?? {
      x: this.pointer.x,
      y: this.pointer.y,
    };

    if (
      this.activeTool === 'line' ||
      this.activeTool === 'rect' ||
      this.activeTool === 'ellipse'
    ) {
      this.drawShape(
        this.activeLayer.pixels,
        this.pointer.startX,
        this.pointer.startY,
        point.x,
        point.y,
        this.activeTool,
      );
      this.previewPixels = null;
    } else if (this.activeTool === 'gradient' && this.gradientBase) {
      this.applyGradient(
        this.activeLayer.pixels,
        this.pointer.startX,
        this.pointer.startY,
        point.x,
        point.y,
      );
      this.previewPixels = null;
      this.gradientBase = null;
    } else if (this.activeTool === 'select' && this.selection) {
      this.selection = this.normalizeSelection(this.selection);
      this.selection.pixels = this.copyPixels(this.selection);
    } else if (this.activeTool === 'lasso') {
      this.finishLasso();
    } else if (
      this.activeTool === 'move' &&
      this.selection &&
      this.previewPixels
    ) {
      this.activeLayer.pixels = [...this.previewPixels];
      this.selection.pixels = this.selectionPixels(this.selection);
      this.previewPixels = null;
      this.moveStartSelection = null;
    }

    this.pointer = null;
    this.render();
  }

  copySelection(): void {
    if (!this.selection) {
      return;
    }
    this.clipboard = {
      ...this.selection,
      pixels: this.selectionPixels(this.selection),
    };
  }

  cutSelection(): void {
    if (this.activeLayerLocked || !this.selection) {
      return;
    }
    this.pushUndo();
    this.copySelection();
    this.eachSelectionPixel(this.selection, (x, y) =>
      this.setPixel(this.activeLayer.pixels, x, y, null),
    );
    this.render();
  }

  /** Lift the selected pixels onto a brand-new layer (copy, or cut from source). */
  selectionToNewLayer(cut = false): void {
    const sel = this.selection;
    if (!sel || (cut && this.activeLayerLocked)) return;
    // Grab the selected pixels from the active layer of the current frame.
    const src = this.activeLayer.pixels;
    const picked: { x: number; y: number; c: string }[] = [];
    this.eachSelectionPixel(sel, (x, y) => {
      const c = src[this.index(x, y)];
      if (c) picked.push({ x, y, c });
    });
    if (!picked.length) return;
    this.pushUndo();
    if (cut) {
      for (const p of picked) this.setPixel(this.activeLayer.pixels, p.x, p.y, null);
    }
    // Insert an aligned new layer above the active one across all frames.
    const at = this.activeLayerIndex + 1;
    const groupId = this.layerGroupId(this.activeLayerIndex);
    const name = `Selection ${this.timelineLayerCount + 1}`;
    for (const frame of this.frames) {
      frame.layers.splice(at, 0, this.createLayer(name, groupId));
    }
    // Paint the lifted pixels onto the new layer of the current frame only.
    const newLayer = this.frames[this.activeFrameIndex].layers[at];
    for (const p of picked) this.setPixel(newLayer.pixels, p.x, p.y, p.c);
    this.activeLayerIndex = at;
    this.render();
  }

  pasteSelection(): void {
    if (this.activeLayerLocked) {
      return;
    }
    if (!this.clipboard) {
      return;
    }
    this.pushUndo();
    const x = Math.min(
      this.width - this.clipboard.w,
      Math.max(0, this.selection?.x ?? 0),
    );
    const y = Math.min(
      this.height - this.clipboard.h,
      Math.max(0, this.selection?.y ?? 0),
    );
    this.selection = {
      ...this.clipboard,
      x,
      y,
      pixels: [...this.clipboard.pixels],
    };
    this.stampSelection(this.selection);
    this.render();
  }

  rotateSelection(clockwise = true): void {
    if (this.activeLayerLocked) {
      return;
    }
    if (!this.selection) {
      this.rotateCanvas(clockwise);
      return;
    }
    this.pushUndo();
    const source = this.copyPixels(this.selection);
    const next = new Array<Pixel>(source.length).fill(null);
    for (let y = 0; y < this.selection.h; y += 1) {
      for (let x = 0; x < this.selection.w; x += 1) {
        const nx = clockwise ? this.selection.h - 1 - y : y;
        const ny = clockwise ? x : this.selection.w - 1 - x;
        next[ny * this.selection.h + nx] = source[y * this.selection.w + x];
      }
    }
    this.eachSelectionPixel(this.selection, (x, y) =>
      this.setPixel(this.activeLayer.pixels, x, y, null),
    );
    this.selection = {
      x: this.selection.x,
      y: this.selection.y,
      w: this.selection.h,
      h: this.selection.w,
      pixels: next,
    };
    this.stampSelection(this.selection);
    this.render();
  }

  flipSelection(horizontal: boolean): void {
    if (this.activeLayerLocked) {
      return;
    }
    const target = this.selection;
    if (!target) {
      this.flipCanvas(horizontal);
      return;
    }
    this.pushUndo();
    const source = this.copyPixels(target);
    const next = new Array<Pixel>(source.length).fill(null);
    for (let y = 0; y < target.h; y += 1) {
      for (let x = 0; x < target.w; x += 1) {
        const nx = horizontal ? target.w - 1 - x : x;
        const ny = horizontal ? y : target.h - 1 - y;
        next[ny * target.w + nx] = source[y * target.w + x];
      }
    }
    this.eachSelectionPixel(target, (x, y) =>
      this.setPixel(this.activeLayer.pixels, x, y, null),
    );
    target.pixels = next;
    this.stampSelection(target);
    this.render();
  }

  rotateCanvas(clockwise = true): void {
    this.pushUndo();
    for (const frame of this.frames) {
      for (const layer of frame.layers) {
        const next = new Array<Pixel>(this.width * this.height).fill(null);
        for (let y = 0; y < this.height; y += 1) {
          for (let x = 0; x < this.width; x += 1) {
            const nx = clockwise ? this.height - 1 - y : y;
            const ny = clockwise ? x : this.width - 1 - x;
            next[ny * this.height + nx] = layer.pixels[this.index(x, y)];
          }
        }
        layer.pixels = next;
      }
    }
    [this.width, this.height] = [this.height, this.width];
    this.selection = null;
    this.render();
  }

  flipCanvas(horizontal: boolean): void {
    this.pushUndo();
    for (const frame of this.frames) {
      for (const layer of frame.layers) {
        const next = new Array<Pixel>(this.width * this.height).fill(null);
        for (let y = 0; y < this.height; y += 1) {
          for (let x = 0; x < this.width; x += 1) {
            const nx = horizontal ? this.width - 1 - x : x;
            const ny = horizontal ? y : this.height - 1 - y;
            next[this.index(nx, ny)] = layer.pixels[this.index(x, y)];
          }
        }
        layer.pixels = next;
      }
    }
    this.render();
  }

  shift(dx: number, dy: number): void {
    if (this.activeLayerLocked) {
      return;
    }
    this.pushUndo();
    const next = new Array<Pixel>(this.width * this.height).fill(null);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const nx = (x + dx + this.width) % this.width;
        const ny = (y + dy + this.height) % this.height;
        next[this.index(nx, ny)] = this.activeLayer.pixels[this.index(x, y)];
      }
    }
    this.activeLayer.pixels = next;
    this.render();
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return;
    }
    this.redoStack.push(this.serialize());
    this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return;
    }
    this.undoStack.push(this.serialize());
    this.restore(snapshot);
  }

  triggerImport(): void {
    this.importInputRef.nativeElement.click();
  }

  async importImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    let image: HTMLImageElement;
    try {
      image = await this.loadImage(file);
    } catch {
      this.notify.error(this.locale.t('notify.importFailed'));
      input.value = '';
      return;
    }
    // Land the import in a fresh tab when requested (keeps current work intact).
    if (this.importTarget === 'new') {
      this.addWorkspace();
    }
    this.pushUndo();
    if (this.importResizeCanvas) {
      this.resizeCanvasForImage(image);
      this.frames = [this.createFrame('Frame 1')];
      this.activeFrameIndex = 0;
      this.activeLayerIndex = 0;
    }
    const sampled = this.sampleImage(image, this.width, this.height);
    this.activeLayer.pixels = sampled.pixels;
    this.palette = sampled.palette;
    input.value = '';
    this.convertModalOpen = false;
    this.render();
  }

  extractPaletteOnly(): void {
    const colors = new Map<string, number>();
    for (const frame of this.frames) {
      for (const layer of frame.layers) {
        for (const color of layer.pixels) {
          if (color) {
            colors.set(color, (colors.get(color) ?? 0) + 1);
          }
        }
      }
    }
    this.palette = [...colors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([color]) => color);
  }

  // ===================== Export suite =====================

  toggleExportMenu(): void {
    const open = !this.exportMenuOpen;
    this.closeTopMenus();
    this.exportMenuOpen = open;
  }

  /** Free users keep PNG @1x/@2x (watermarked); the rest is Pro. */
  private async requirePro(feature: string): Promise<boolean> {
    if (this.premium.isPro) return true;
    const go = await this.askConfirm({
      title: `${feature} is a Pro feature`,
      message: 'Unlock Pro to use it. Enter a license key?',
      okLabel: 'Enter key',
    });
    if (go) await this.promptActivatePro();
    return this.premium.isPro;
  }

  async promptActivatePro(): Promise<void> {
    const key = await this.askPrompt({
      title: 'Unlock Pro',
      message: 'Enter your Pro license key.',
      placeholder: 'License key',
      okLabel: 'Activate',
    });
    if (key == null) return;
    if (this.premium.activate(key)) {
      this.notify.success(this.locale.t('notify.proUnlocked'));
    } else {
      this.notify.error(this.locale.t('notify.proKeyInvalid'));
    }
  }

  /** Visible frames; falls back to all frames if none are visible. */
  private exportFrameIndices(): number[] {
    const visible = this.frames
      .map((_, i) => i)
      .filter((i) => this.isFrameVisible(i));
    return visible.length ? visible : this.frames.map((_, i) => i);
  }

  /** Render one composited frame to an offscreen canvas at the given scale. */
  private renderFrameCanvas(frameIndex: number, scale: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = this.width * scale;
    canvas.height = this.height * scale;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = false;
      this.drawComposite(ctx, frameIndex, scale, false);
    }
    return canvas;
  }

  /** Stamp a small watermark in the corner (free tier only). */
  private stampWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (this.premium.isPro) return;
    const pad = Math.max(4, Math.round(Math.min(w, h) * 0.02));
    const fontPx = Math.max(9, Math.round(Math.min(w, h) * 0.05));
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.font = `600 ${fontPx}px Inter, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    const text = 'Pixel Art Studio';
    ctx.lineWidth = Math.max(2, fontPx / 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(text, w - pad, h - pad);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(text, w - pad, h - pad);
    ctx.restore();
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const link = document.createElement('a');
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private downloadCanvas(canvas: HTMLCanvasElement, filename: string): void {
    canvas.toBlob((blob) => {
      if (blob) this.downloadBlob(blob, filename);
    }, 'image/png');
  }

  /** Export the current frame as PNG at the given scale (1/2/4/8). */
  async exportPngScale(scale: number): Promise<void> {
    this.exportMenuOpen = false;
    if (scale > 2 && !(await this.requirePro(`PNG @${scale}x export`))) return;
    const canvas = this.renderFrameCanvas(this.activeFrameIndex, scale);
    const ctx = canvas.getContext('2d');
    if (ctx) this.stampWatermark(ctx, canvas.width, canvas.height);
    this.downloadCanvas(canvas, `pixel-art-${this.width}x${this.height}@${scale}x.png`);
  }

  /** Pack every (visible) frame into a sprite sheet PNG + engine-ready JSON atlas. */
  async exportSpriteSheet(layout: 'grid' | 'row' = 'grid', scale = 1): Promise<void> {
    this.exportMenuOpen = false;
    if (this.exportBusy) return;
    this.exportBusy = true;
    try {
      if (!(await this.requirePro('Sprite sheet export'))) return;
      const indices = this.exportFrameIndices();
      const count = indices.length;
      let cols: number;
      if (layout === 'row') {
        cols = count; // single horizontal strip
      } else if (this.sheetColumns > 0) {
        cols = Math.min(this.sheetColumns, count); // user-configured columns
      } else {
        cols = Math.min(count, Math.ceil(Math.sqrt(count)) || 1); // auto square-ish
      }
      const rows = Math.ceil(count / cols);
      const fw = this.width * scale;
      const fh = this.height * scale;

      const sheet = document.createElement('canvas');
      sheet.width = cols * fw;
      sheet.height = rows * fh;
      const ctx = sheet.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      const atlasFrames = indices.map((frameIndex, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * fw;
        const y = row * fh;
        const frameCanvas = this.renderFrameCanvas(frameIndex, scale);
        ctx.drawImage(frameCanvas, x, y);
        return {
          index: i,
          name: this.frames[frameIndex]?.name ?? `frame_${i}`,
          x,
          y,
          w: fw,
          h: fh,
          duration: this.frames[frameIndex]?.duration ?? 100,
        };
      });

      const base = `${this.exportBaseName()}-sheet`;
      this.stampWatermark(ctx, sheet.width, sheet.height);
      this.downloadCanvas(sheet, `${base}.png`);

      // Map tag ranges (original frame indices) onto exported sheet positions.
      const posOf = new Map<number, number>();
      indices.forEach((orig, i) => posOf.set(orig, i));
      const frameTags = this.tags
        .map((t) => {
          const positions: number[] = [];
          for (let f = t.from; f <= t.to; f += 1) {
            const p = posOf.get(f);
            if (p != null) positions.push(p);
          }
          if (!positions.length) return null;
          return {
            name: t.name,
            from: Math.min(...positions),
            to: Math.max(...positions),
            direction: t.direction,
            repeat: t.repeat,
            color: t.color,
          };
        })
        .filter(Boolean);

      const pivot = this.pivotPoint;
      const atlas = {
        app: 'Pixel Art Studio',
        animation: this.activeWorkspace.name,
        image: `${base}.png`,
        layout,
        frameWidth: fw,
        frameHeight: fh,
        scale,
        columns: cols,
        rows,
        count,
        pivot: { x: pivot.x * scale, y: pivot.y * scale, preset: this.pivotPreset },
        frames: atlasFrames,
        frameTags,
      };
      this.downloadBlob(
        new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' }),
        `${base}.json`,
      );
      this.notify.success(this.locale.t('export.spritesheetDone'));
    } finally {
      this.exportBusy = false;
    }
  }

  /** Export the (visible) frames as an animated GIF at the given scale. */
  async exportGif(scale = 1): Promise<void> {
    this.exportMenuOpen = false;
    if (this.exportBusy) return;
    this.exportBusy = true;
    try {
      if (!(await this.requirePro('Animated GIF export'))) return;
      const indices = this.exportFrameIndices();
      const gif = GIFEncoder();
      this.exportProgress = { done: 0, total: indices.length };
      for (let i = 0; i < indices.length; i += 1) {
        this.exportProgress = { done: i, total: indices.length };
        // Yield each frame so the overlay can repaint (encode is otherwise blocking).
        await new Promise<void>((r) => setTimeout(r));
        const canvas = this.renderFrameCanvas(indices[i], scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const delay = Math.max(20, Math.round(this.frames[indices[i]]?.duration ?? 100));
        this.writeGifFrame(gif, ctx, canvas.width, canvas.height, delay);
      }
      gif.finish();
      this.downloadBlob(
        new Blob([gif.bytes()], { type: 'image/gif' }),
        `${this.exportBaseName()}.gif`,
      );
      this.notify.success(this.locale.t('export.gifDone'));
    } finally {
      this.exportBusy = false;
      this.exportProgress = null;
    }
  }

  /** Background fill for video export (video has no transparency). */
  videoBg = '#ffffff';

  /** True while a long export (GIF / timelapse / video / sheet) runs — drives the overlay + disables export buttons. */
  exportBusy = false;
  /** Per-frame progress for encodes that loop over frames; null = indeterminate. */
  exportProgress: { done: number; total: number } | null = null;

  /**
   * Export the animation as a video for social media (GIF is often rejected).
   * Records a scaled offscreen canvas with MediaRecorder — MP4 (H.264) when the
   * browser supports it, otherwise WebM. No dependencies.
   */
  async exportVideo(scale = 4): Promise<void> {
    this.exportMenuOpen = false;
    if (this.exportBusy) return;
    if (!this.isBrowser || typeof MediaRecorder === 'undefined') {
      this.notify.error(this.locale.t('notify.videoUnsupported'));
      return;
    }
    this.exportBusy = true;
    try {
      if (!(await this.requirePro('Video (MP4) export'))) return;
      const indices = this.exportFrameIndices();
      if (!indices.length) return;
      const W = this.width * scale;
      const H = this.height * scale;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const ctx = off.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      const mp4 = 'video/mp4;codecs=avc1.42E01E';
      const webm = 'video/webm;codecs=vp9';
      const type = MediaRecorder.isTypeSupported(mp4)
        ? mp4
        : MediaRecorder.isTypeSupported(webm)
          ? webm
          : 'video/webm';
      const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm';

      const durs = indices.map((fi) => Math.max(40, this.frames[fi]?.duration ?? 130));
      const total = durs.reduce((a, b) => a + b, 0);
      const drawAt = (elapsed: number) => {
        let t = elapsed % total;
        let fi = indices[0];
        for (let k = 0; k < indices.length; k += 1) {
          if (t < durs[k]) {
            fi = indices[k];
            break;
          }
          t -= durs[k];
        }
        ctx.fillStyle = this.videoBg;
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(this.renderFrameCanvas(fi, scale), 0, 0);
      };

      drawAt(0);
      const stream = off.captureStream(60);
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000 });
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((res) => {
        rec.onstop = () => res();
      });
      rec.start();
      // Loop a few times so very short animations aren't sub-second clips.
      const loops = Math.max(1, Math.ceil(2000 / total));
      const runMs = total * loops;
      const start = performance.now();
      await new Promise<void>((res) => {
        const tick = () => {
          const e = performance.now() - start;
          drawAt(e);
          if (e >= runMs) {
            res();
            return;
          }
          requestAnimationFrame(tick);
        };
        tick();
      });
      rec.stop();
      await stopped;
      this.downloadBlob(new Blob(chunks, { type }), `${this.exportBaseName()}.${ext}`);
      this.notify.success(this.locale.t('export.videoDone'));
    } finally {
      this.exportBusy = false;
      this.exportProgress = null;
    }
  }

  /**
   * Quantize a canvas region and write it as a GIF frame, mapping only truly
   * transparent pixels (alpha 0) to the transparent index — so opaque black
   * is never turned transparent.
   */
  private writeGifFrame(
    gif: ReturnType<typeof GIFEncoder>,
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    delay: number,
  ): void {
    const { data } = ctx.getImageData(0, 0, width, height);
    const palette = quantize(data, 256, { format: 'rgba4444' });
    const index = applyPalette(data, palette, 'rgba4444');
    // gifenc returns RGBA palette entries for rgba4444; find the transparent one.
    const ti = (palette as number[][]).findIndex(
      (c) => c.length >= 4 && c[3] === 0,
    );
    gif.writeFrame(index, width, height, {
      palette,
      delay,
      transparent: ti >= 0,
      transparentIndex: ti >= 0 ? ti : 0,
      dispose: 2,
    });
  }

  private exportBaseName(): string {
    return (
      this.activeWorkspace.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'pixel-art'
    );
  }

  private buildProjectFile(): PixelArtProjectFile {
    this.saveCurrentWorkspace();
    return {
      app: 'Pixel Studio',
      version: 1,
      exportedAt: new Date().toISOString(),
      activeWorkspaceIndex: this.activeWorkspaceIndex,
      workspaceIdSeed: this.workspaceIdSeed,
      workspaces: this.workspaces.map((workspace) =>
        this.cloneWorkspace(workspace),
      ),
      settings: {
        zoom: this.zoom,
        displayZoom: this.displayZoom,
        showGrid: this.showGrid,
        onionSkin: this.onionSkin,
        symmetry: this.symmetry,
        pixelPerfect: this.pixelPerfect,
        brushSize: this.brushSize,
        importResizeCanvas: this.importResizeCanvas,
        importLongSide: this.importLongSide,
        importFit: this.importFit,
        importPaletteSize: this.importPaletteSize,
        importDither: this.importDither,
        importSharpen: this.importSharpen,
        importContrast: this.importContrast,
      },
    };
  }

  exportProject(): void {
    const project = this.buildProjectFile();
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    const activeName =
      this.activeWorkspace.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'pixel-art';
    link.download = `${activeName}.pixelart.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
  }

  // ===================== Project library (IndexedDB) =====================

  /** Open the Save / Recent projects modal on the given tab. */
  async openProjectsModal(tab: 'save' | 'recent'): Promise<void> {
    this.exportMenuOpen = false;
    this.projectsTab = tab;
    this.saveState = 'idle';
    this.saveName =
      this.recentProjects.find((p) => p.id === this.currentProjectId)?.name ||
      this.activeWorkspace?.name ||
      'Untitled';
    this.projectsModalOpen = true;
    await this.refreshRecentProjects();
  }

  closeProjectsModal(): void {
    this.projectsModalOpen = false;
  }

  private async refreshRecentProjects(): Promise<void> {
    try {
      this.recentProjects = await this.projectStore.list();
    } catch {
      this.recentProjects = [];
    }
  }

  /** Small PNG preview of the active frame for the library card. */
  private projectThumbnail(): string {
    if (!this.isBrowser) return '';
    try {
      return this.renderFrameCanvas(this.activeFrameIndex, 1).toDataURL('image/png');
    } catch {
      return '';
    }
  }

  /** Save the whole project. `asNew` forces a new library entry (Save As). */
  async saveProject(asNew = false): Promise<void> {
    const name = this.saveName.trim() || 'Untitled';
    this.saveState = 'saving';
    try {
      const now = Date.now();
      const reuse = !asNew && this.currentProjectId;
      const existing = reuse
        ? this.recentProjects.find((p) => p.id === this.currentProjectId)
        : undefined;
      const id = reuse && this.currentProjectId
        ? this.currentProjectId
        : this.newProjectId();
      await this.projectStore.put({
        id,
        name,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        thumbnail: this.projectThumbnail(),
        data: this.buildProjectFile(),
      });
      this.setCurrentProject(id);
      this.saveState = 'saved';
      await this.refreshRecentProjects();
      // Auto-close shortly after a successful save.
      setTimeout(() => {
        if (this.saveState === 'saved') this.projectsModalOpen = false;
      }, 900);
    } catch {
      this.saveState = 'error';
      this.notify.error(this.locale.t('notify.saveFailed'));
    }
  }

  /** Load a saved project into the editor. */
  async openStoredProject(id: string): Promise<void> {
    const project = await this.projectStore.get(id);
    if (!project) return;
    try {
      this.loadProject(project.data as Parameters<typeof this.loadProject>[0]);
      this.setCurrentProject(id);
      this.projectsModalOpen = false;
    } catch {
      this.notify.error(this.locale.t('notify.openFailed'));
    }
  }

  async deleteStoredProject(id: string, event?: Event): Promise<void> {
    event?.stopPropagation();
    const meta = this.recentProjects.find((p) => p.id === id);
    const ok = await this.askConfirm({
      title: this.locale.t('projects.deleteTitle'),
      message: this.locale.t('projects.deleteMsg', { name: meta?.name ?? '—' }),
      okLabel: this.locale.t('common.delete'),
      danger: true,
    });
    if (!ok) return;
    await this.projectStore.delete(id);
    if (this.currentProjectId === id) this.setCurrentProject(null);
    await this.refreshRecentProjects();
  }

  private setCurrentProject(id: string | null): void {
    this.currentProjectId = id;
    try {
      if (id) localStorage.setItem(this.currentProjectKey, id);
      else localStorage.removeItem(this.currentProjectKey);
    } catch {
      /* storage unavailable */
    }
  }

  private newProjectId(): string {
    try {
      return crypto.randomUUID();
    } catch {
      return `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    }
  }

  /** Relative "x phút trước" label for the library cards. */
  projectAge(updatedAt: number): string {
    const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
    if (s < 60) return 'vừa xong';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} phút trước`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} giờ trước`;
    return `${Math.round(h / 24)} ngày trước`;
  }

  // ===================== Autosave =====================

  private readonly autosaveKey = 'pixelart.autosave.v1';
  private autosaveTimer?: number;

  /** Debounced full-project autosave to localStorage (fires ~1.5s after idle). */
  private scheduleAutosave(): void {
    if (!this.isBrowser) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          this.autosaveKey,
          JSON.stringify(this.buildProjectFile()),
        );
      } catch {
        /* storage quota / private mode — ignore */
      }
    }, 1500);
  }

  private restoreAutosave(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      const raw = localStorage.getItem(this.autosaveKey);
      if (!raw) return false;
      this.loadProject(JSON.parse(raw) as PixelArtProjectFile);
      return true;
    } catch {
      return false;
    }
  }

  /** Wipe the autosave and start from a clean sprite. */
  async resetEditor(): Promise<void> {
    this.fileMenuOpen = false;
    const ok = await this.askConfirm({
      title: 'Start fresh?',
      message: 'This clears the auto-saved project and starts a blank sprite.',
      okLabel: 'Start fresh',
      danger: true,
    });
    if (!ok) return;
    try {
      localStorage.removeItem(this.autosaveKey);
    } catch {
      /* ignore */
    }
    this.workspaces = [this.createBlankWorkspace('Workspace 1', 1)];
    this.workspaceIdSeed = 2;
    this.activeWorkspaceIndex = 0;
    this.applyWorkspace(this.workspaces[0]);
  }

  /** 'replace' opens a project (wipes session); 'append' adds its workspaces as tabs. */
  private projectImportMode: 'replace' | 'append' = 'replace';

  triggerProjectImport(mode: 'replace' | 'append' = 'replace'): void {
    this.projectImportMode = mode;
    this.projectInputRef.nativeElement.click();
  }

  async importProject(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    try {
      const project = JSON.parse(await file.text()) as PixelArtProjectFile;
      if (this.projectImportMode === 'append') this.appendProject(project);
      else this.loadProject(project);
    } finally {
      input.value = '';
      this.projectImportMode = 'replace';
    }
  }

  /** Add a project's workspaces as new tabs, keeping existing ones. */
  private appendProject(project: PixelArtProjectFile): void {
    if (
      project.app !== 'Pixel Studio' ||
      !Array.isArray(project.workspaces) ||
      project.workspaces.length === 0
    ) {
      throw new Error('Unsupported Pixel Studio project file.');
    }
    this.saveCurrentWorkspace();
    const startIndex = this.workspaces.length;
    for (const ws of project.workspaces) {
      const normalized = this.normalizeWorkspace(ws);
      normalized.id = this.workspaceIdSeed;
      this.workspaceIdSeed += 1;
      this.workspaces.push(normalized);
    }
    this.activeWorkspaceIndex = startIndex;
    this.applyWorkspace(this.activeWorkspace);
  }

  selectFrame(index: number): void {
    this.selectedFrames = new Set<number>([index]);
    this.frameSelAnchor = index;
    this.setActiveFrame(index);
  }

  selectLayer(index: number): void {
    this.flushAdjust();
    this.activeLayerIndex = index;
    this.render();
  }

  get activeLayerLocked(): boolean {
    const layer = this.activeLayer;
    if (!layer) return false;
    if (layer.locked) return true;
    const g = this.groupById(layer.groupId);
    return !!g && g.locked;
  }

  isLayerLocked(layerIndex: number): boolean {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) return !!layer.locked;
    }
    return false;
  }

  toggleLayerLock(layerIndex: number, event?: Event): void {
    event?.stopPropagation();
    const next = !this.isLayerLocked(layerIndex);
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.locked = next;
    }
  }

  layerOpacityAt(layerIndex: number): number {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) return layer.opacity ?? 1;
    }
    return 1;
  }

  setLayerOpacity(layerIndex: number, event: Event): void {
    const value = this.clamp(parseFloat((event.target as HTMLInputElement).value), 0, 1);
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.opacity = value;
    }
    this.refreshAllFrameThumbnails();
    this.render();
  }

  renameLayer(layerIndex: number, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (!name) return;
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.name = name;
    }
  }

  // ===================== Layer blend modes =====================

  layerBlendAt(layerIndex: number): BlendMode {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) return layer.blend ?? 'normal';
    }
    return 'normal';
  }

  private setLayerBlendAcross(layerIndex: number, blend: BlendMode): void {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.blend = blend;
    }
  }

  get activeLayerBlend(): BlendMode {
    return this.layerBlendAt(this.activeLayerIndex);
  }

  setActiveLayerBlend(blend: BlendMode): void {
    this.setLayerBlendAcross(this.activeLayerIndex, blend);
    this.refreshAllFrameThumbnails();
    this.render();
  }

  blendLabel(blend: BlendMode): string {
    return this.blendModes.find((b) => b.value === blend)?.label ?? 'Normal';
  }

  // ===================== Layer groups =====================

  getGroup(id: number | null | undefined): LayerGroup | undefined {
    return this.groupById(id);
  }

  layerGroupId(layerIndex: number): number | null {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) return layer.groupId ?? null;
    }
    return null;
  }

  private setLayerGroupAcross(layerIndex: number, groupId: number | null): void {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.groupId = groupId;
    }
  }

  groupOf(layerIndex: number): LayerGroup | null {
    return this.groupById(this.layerGroupId(layerIndex)) ?? null;
  }

  /** True when this layer is the first (lowest index) member of its group. */
  isGroupStart(layerIndex: number): boolean {
    const gid = this.layerGroupId(layerIndex);
    if (gid == null) return false;
    for (let i = 0; i < layerIndex; i += 1) {
      if (this.layerGroupId(i) === gid) return false;
    }
    return true;
  }

  /** Grouped layers are hidden from the timeline when their group is collapsed. */
  isLayerRowHidden(layerIndex: number): boolean {
    const g = this.groupOf(layerIndex);
    return !!g && g.collapsed;
  }

  /** Drop any empty groups (no remaining member layer). */
  private pruneGroups(): void {
    const used = new Set<number>();
    for (let i = 0; i < this.timelineLayerCount; i += 1) {
      const gid = this.layerGroupId(i);
      if (gid != null) used.add(gid);
    }
    this.groups = this.groups.filter((g) => used.has(g.id));
  }

  /** Wrap the active layer in a new group. */
  createGroupFromActive(): void {
    if (this.layerGroupId(this.activeLayerIndex) != null) return;
    this.pushUndo();
    const group: LayerGroup = {
      id: this.groupIdSeed++,
      name: `Group ${this.groups.length + 1}`,
      visible: true,
      locked: false,
      collapsed: false,
      opacity: 1,
      color: this.groupColors[this.groups.length % this.groupColors.length],
    };
    this.groups = [...this.groups, group];
    this.setLayerGroupAcross(this.activeLayerIndex, group.id);
    this.layerMenu = null;
    this.render();
  }

  /** Add a new ungrouped layer just above the given group, keeping the group's run intact. */
  addLayerAboveGroup(groupId: number): void {
    this.pushUndo();
    const name = `Layer ${this.timelineLayerCount + 1}`;
    // Insert before the group's first member so the new layer stays outside the group.
    let at = this.timelineLayerCount;
    for (let i = 0; i < this.timelineLayerCount; i += 1) {
      if (this.layerGroupId(i) === groupId) {
        at = i;
        break;
      }
    }
    for (const frame of this.frames) {
      frame.layers.splice(at, 0, this.createLayer(name, null));
    }
    this.activeLayerIndex = at;
    this.groupMenu = null;
    this.render();
  }

  moveLayerToGroup(layerIndex: number, groupId: number | null): void {
    this.pushUndo();
    this.setLayerGroupAcross(layerIndex, groupId);
    this.pruneGroups();
    this.layerMenu = null;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  async renameGroup(id: number): Promise<void> {
    const g = this.groupById(id);
    if (!g) return;
    const name = await this.askPrompt({
      title: 'Rename group',
      value: g.name,
      okLabel: 'Rename',
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (trimmed) g.name = trimmed;
  }

  toggleGroupVisibility(id: number, event?: Event): void {
    event?.stopPropagation();
    const g = this.groupById(id);
    if (!g) return;
    g.visible = !g.visible;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  toggleGroupLock(id: number, event?: Event): void {
    event?.stopPropagation();
    const g = this.groupById(id);
    if (g) g.locked = !g.locked;
  }

  toggleGroupCollapsed(id: number, event?: Event): void {
    event?.stopPropagation();
    const g = this.groupById(id);
    if (g) g.collapsed = !g.collapsed;
  }

  setGroupOpacity(id: number, event: Event): void {
    const g = this.groupById(id);
    if (!g) return;
    g.opacity = this.clamp(
      parseFloat((event.target as HTMLInputElement).value),
      0,
      1,
    );
    this.refreshAllFrameThumbnails();
    this.render();
  }

  cycleGroupColor(id: number): void {
    const g = this.groupById(id);
    if (!g) return;
    const i = this.groupColors.indexOf(g.color);
    g.color = this.groupColors[(i + 1) % this.groupColors.length];
  }

  /** Ungroup: members become ungrouped layers; the group is removed. */
  ungroup(id: number): void {
    this.pushUndo();
    for (let i = 0; i < this.timelineLayerCount; i += 1) {
      if (this.layerGroupId(i) === id) this.setLayerGroupAcross(i, null);
    }
    this.groups = this.groups.filter((g) => g.id !== id);
    this.groupMenu = null;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Drag-and-drop reorder a frame (column) to a new position. */
  // ===================== Multi-frame selection =====================

  isFrameSelected(i: number): boolean {
    return this.selectedFrames.has(i);
  }

  get isMovingFrames(): boolean {
    return this.frameDrag?.mode === 'move';
  }

  get hasFrameClipboard(): boolean {
    return this.copiedFrames.length > 0;
  }

  private selectFrameRange(a: number, b: number): void {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    this.selectedFrames = new Set<number>();
    for (let i = lo; i <= hi; i += 1) this.selectedFrames.add(i);
  }

  /** Pointer down on a frame header — handles click / shift / ctrl / drag start. */
  onFrameDown(i: number, event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.shiftKey) {
      // Shift = (drag to) select a range.
      this.selectFrameRange(this.frameSelAnchor, i);
      this.setActiveFrame(i);
      this.frameDrag = { mode: 'select', start: this.frameSelAnchor, moved: false };
    } else if (event.ctrlKey || event.metaKey) {
      if (this.selectedFrames.has(i) && this.selectedFrames.size > 1) {
        this.selectedFrames.delete(i);
      } else {
        this.selectedFrames.add(i);
      }
      this.frameSelAnchor = i;
      this.setActiveFrame(i);
      this.frameDrag = null;
    } else {
      // Plain = move. Grab this frame (select it if it wasn't part of the
      // current selection); a drag moves it, a click (no drag) just selects it.
      if (!this.selectedFrames.has(i)) {
        this.selectedFrames = new Set<number>([i]);
        this.frameSelAnchor = i;
        this.setActiveFrame(i);
      }
      this.frameDrag = { mode: 'move', start: i, moved: false };
    }
    this.frameDragOver = i;
  }

  /** Collapse a multi-frame selection back to the active frame. */
  collapseFrameSelection(): void {
    if (this.selectedFrames.size > 1) {
      this.selectedFrames = new Set<number>([this.activeFrameIndex]);
      this.frameSelAnchor = this.activeFrameIndex;
    }
  }

  /** Clicking empty timeline space (not a frame) clears the multi-selection. */
  onTimelineBackgroundDown(event: PointerEvent): void {
    if (event.target === event.currentTarget) {
      this.collapseFrameSelection();
    }
  }

  /** Pointer entered a frame header while dragging. */
  onFrameEnter(i: number): void {
    if (!this.frameDrag) return;
    if (i !== this.frameDrag.start) this.frameDrag.moved = true;
    this.frameDragOver = i;
    if (this.frameDrag.mode === 'select') {
      this.selectFrameRange(this.frameSelAnchor, i);
      this.setActiveFrame(i);
    }
  }

  /** While moving frames, choose the drop side (left/right) from the pointer position. */
  onFrameMove(i: number, event: PointerEvent): void {
    if (!this.frameDrag || this.frameDrag.mode !== 'move') return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.frameDragOver = i;
    this.frameDropAfter = event.clientX > rect.left + rect.width / 2;
  }

  @HostListener('window:pointerup')
  endFrameDrag(): void {
    const drag = this.frameDrag;
    if (!drag) return;
    this.frameDrag = null;
    if (drag.mode === 'move') {
      if (drag.moved && this.frameDragOver >= 0) {
        const gap = this.frameDragOver + (this.frameDropAfter ? 1 : 0);
        this.moveSelectedFramesTo(gap);
      } else {
        // Treated as a plain click on an already-selected frame.
        this.selectedFrames = new Set<number>([drag.start]);
        this.frameSelAnchor = drag.start;
        this.setActiveFrame(drag.start);
      }
    }
    this.frameDragOver = -1;
    this.frameDropAfter = false;
  }

  /** Set the active/preview frame without disturbing the selection set. */
  private setActiveFrame(i: number): void {
    this.activeFrameIndex = i;
    this.previewFrameIndex = i;
    this.activeLayerIndex = Math.min(this.activeLayerIndex, this.activeFrame.layers.length - 1);
    this.render();
  }

  /** Move the selected frames (as a block) to the insertion point `gap` (0..length). */
  private moveSelectedFramesTo(gap: number): void {
    const indices = [...this.selectedFrames].sort((a, b) => a - b);
    if (!indices.length) return;
    const moving = indices.map((i) => this.frames[i]);
    const remaining = this.frames.filter((_, i) => !this.selectedFrames.has(i));
    // Translate the original-array gap into an index in the trimmed array.
    const before = indices.filter((i) => i < gap).length;
    const insertAt = this.clamp(gap - before, 0, remaining.length);
    this.pushUndo();
    remaining.splice(insertAt, 0, ...moving);
    this.frames = remaining;
    // Reordering frames is ambiguous for tag ranges; keep them in-bounds.
    this.clampTags();
    this.selectedFrames = new Set<number>(moving.map((_, k) => insertAt + k));
    this.setActiveFrame(insertAt);
    this.refreshAllFrameThumbnails();
  }

  // ===================== Copy / paste frames =====================

  copySelectedFrames(): void {
    const indices = [...this.selectedFrames].sort((a, b) => a - b);
    this.copiedFrames = indices.map((i) =>
      this.cloneFrame(this.frames[i], this.frames[i].name),
    );
  }

  /** Paste copied frames right after the active frame. */
  pasteFrames(): void {
    if (!this.copiedFrames.length) return;
    this.pushUndo();
    const at = this.activeFrameIndex + 1;
    const clones = this.copiedFrames.map((f) => this.cloneFrame(f, f.name));
    this.shiftTagsForInsert(at, clones.length);
    this.frames.splice(at, 0, ...clones);
    this.selectedFrames = new Set<number>(clones.map((_, k) => at + k));
    this.frameSelAnchor = at;
    this.setActiveFrame(at);
    this.refreshAllFrameThumbnails();
  }

  // ===================== Animation tags =====================

  /** The tag scoped for playback, or null when playing all frames. */
  get playingTag(): AnimTag | null {
    if (this.activeTagId == null) return null;
    return this.tags.find((t) => t.id === this.activeTagId) ?? null;
  }

  /** Total pixel width of the frame track (for the tag overlay). */
  get tagTrackWidth(): number {
    const n = this.frames.length;
    return n > 0 ? n * this.TILE_W + (n - 1) * this.TILE_GAP : 0;
  }

  tagLeft(tag: AnimTag): number {
    return tag.from * (this.TILE_W + this.TILE_GAP);
  }

  tagWidth(tag: AnimTag): number {
    const count = Math.max(1, tag.to - tag.from + 1);
    return count * this.TILE_W + (count - 1) * this.TILE_GAP;
  }

  tagDirectionGlyph(dir: TagDirection): string {
    return dir === 'reverse' ? '←' : dir === 'pingpong' ? '↔' : '→';
  }

  tagDirectionLabel(dir: TagDirection): string {
    return dir === 'reverse'
      ? 'Reverse'
      : dir === 'pingpong'
        ? 'Ping-pong'
        : 'Forward';
  }

  tagById(id: number): AnimTag | undefined {
    return this.tags.find((t) => t.id === id);
  }

  /** Create a tag spanning the currently selected frame(s). */
  addTagFromSelection(): void {
    const sel = [...this.selectedFrames].sort((a, b) => a - b);
    const from = sel.length ? sel[0] : this.activeFrameIndex;
    const to = sel.length ? sel[sel.length - 1] : this.activeFrameIndex;
    const tag: AnimTag = {
      id: this.tagIdSeed++,
      name: `Tag ${this.tags.length + 1}`,
      from,
      to,
      color: this.tagColors[this.tags.length % this.tagColors.length],
      direction: 'forward',
      repeat: 0,
    };
    this.tags = [...this.tags, tag];
    this.activeTagId = tag.id;
  }

  /** Select a tag: scope playback to it and select its frame range. */
  selectTag(tag: AnimTag): void {
    this.activeTagId = tag.id;
    this.activeFrameIndex = this.clamp(tag.from, 0, this.frames.length - 1);
    this.previewFrameIndex = this.activeFrameIndex;
    const set = new Set<number>();
    for (let i = tag.from; i <= tag.to && i < this.frames.length; i += 1) set.add(i);
    this.selectedFrames = set.size ? set : new Set<number>([this.activeFrameIndex]);
    this.frameSelAnchor = tag.from;
    this.render();
  }

  /** Set which tag drives playback (null = all frames). */
  setPlayTag(id: number | null): void {
    this.activeTagId = id;
  }

  async renameTag(id: number): Promise<void> {
    const tag = this.tagById(id);
    if (!tag) return;
    const name = await this.askPrompt({
      title: 'Rename tag',
      value: tag.name,
      okLabel: 'Rename',
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (trimmed) tag.name = trimmed;
  }

  cycleTagDirection(id: number): void {
    const tag = this.tagById(id);
    if (!tag) return;
    const order: TagDirection[] = ['forward', 'reverse', 'pingpong'];
    tag.direction = order[(order.indexOf(tag.direction) + 1) % order.length];
  }

  cycleTagColor(id: number): void {
    const tag = this.tagById(id);
    if (!tag) return;
    const i = this.tagColors.indexOf(tag.color);
    tag.color = this.tagColors[(i + 1) % this.tagColors.length];
  }

  async setTagRepeat(id: number): Promise<void> {
    const tag = this.tagById(id);
    if (!tag) return;
    const val = await this.askPrompt({
      title: 'Tag repeat',
      message: 'Number of loops written to the export JSON (0 = forever).',
      value: String(tag.repeat),
      okLabel: 'Set',
    });
    if (val == null) return;
    tag.repeat = Math.max(0, Math.floor(Number(val)) || 0);
  }

  deleteTag(id: number): void {
    this.tags = this.tags.filter((t) => t.id !== id);
    if (this.activeTagId === id) this.activeTagId = null;
    this.tagMenu = null;
  }

  // ---- Tag right-click context menu ----

  onTagContextMenu(event: MouseEvent, id: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.tagById(id)) return;
    this.activeTagId = id;
    this.tagMenu = { x: event.clientX, y: event.clientY, id };
    if (this.isBrowser) {
      requestAnimationFrame(() => this.clampTagMenu());
    }
  }

  private clampTagMenu(): void {
    const el = this.tagMenuRef?.nativeElement;
    if (!this.tagMenu || !el) return;
    const pad = 8;
    const maxX = window.innerWidth - el.offsetWidth - pad;
    const maxY = window.innerHeight - el.offsetHeight - pad;
    this.tagMenu = {
      ...this.tagMenu,
      x: Math.max(pad, Math.min(this.tagMenu.x, maxX)),
      y: Math.max(pad, Math.min(this.tagMenu.y, maxY)),
    };
  }

  closeTagMenu(): void {
    this.tagMenu = null;
  }

  // ---- Group header right-click context menu ----

  onGroupContextMenu(event: MouseEvent, id: number): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.groupById(id)) return;
    this.groupMenu = { x: event.clientX, y: event.clientY, id };
    if (this.isBrowser) {
      requestAnimationFrame(() => this.clampGroupMenu());
    }
  }

  private clampGroupMenu(): void {
    const el = this.groupMenuRef?.nativeElement;
    if (!this.groupMenu || !el) return;
    const pad = 8;
    const maxX = window.innerWidth - el.offsetWidth - pad;
    const maxY = window.innerHeight - el.offsetHeight - pad;
    this.groupMenu = {
      ...this.groupMenu,
      x: Math.max(pad, Math.min(this.groupMenu.x, maxX)),
      y: Math.max(pad, Math.min(this.groupMenu.y, maxY)),
    };
  }

  closeGroupMenu(): void {
    this.groupMenu = null;
  }

  // ---- Tag index bookkeeping when frames mutate ----

  private shiftTagsForInsert(at: number, count: number): void {
    for (const t of this.tags) {
      if (at <= t.from) {
        t.from += count;
        t.to += count;
      } else if (at <= t.to) {
        t.to += count;
      }
    }
  }

  private shiftTagsForDelete(removed: number[]): void {
    const set = new Set(removed);
    const remap = (i: number) => i - removed.filter((r) => r < i).length;
    const next: AnimTag[] = [];
    for (const t of this.tags) {
      let from = -1;
      let to = -1;
      for (let i = t.from; i <= t.to; i += 1) {
        if (!set.has(i)) {
          const m = remap(i);
          if (from < 0) from = m;
          to = m;
        }
      }
      if (from >= 0) {
        next.push({ ...t, from, to });
      } else if (this.activeTagId === t.id) {
        this.activeTagId = null;
      }
    }
    this.tags = next;
  }

  private clampTags(): void {
    const max = this.frames.length - 1;
    this.tags = this.tags.map((t) => {
      const from = this.clamp(t.from, 0, max);
      const to = this.clamp(t.to, 0, max);
      return { ...t, from: Math.min(from, to), to: Math.max(from, to) };
    });
  }

  /** Drag-and-drop reorder a layer to a new position, across every frame. */
  onLayerDrop(event: CdkDragDrop<unknown>): void {
    const from = event.previousIndex;
    const to = event.currentIndex;
    if (from === to) return;
    this.pushUndo();
    for (const frame of this.frames) {
      if (from < frame.layers.length && to < frame.layers.length) {
        moveItemInArray(frame.layers, from, to);
      }
    }
    this.activeLayerIndex = to;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Move the active layer up (-1) or down (+1) the stack, across every frame. */
  moveLayer(delta: number): void {
    const from = this.activeLayerIndex;
    const to = from + delta;
    if (to < 0 || to >= this.timelineLayerCount) return;
    this.pushUndo();
    for (const frame of this.frames) {
      const a = frame.layers[from];
      const b = frame.layers[to];
      if (a && b) {
        frame.layers[from] = b;
        frame.layers[to] = a;
      }
    }
    this.activeLayerIndex = to;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  // ---- Layer right-click context menu ----

  /** Open the layer context menu at the cursor (Aseprite-style). */
  onLayerContextMenu(event: MouseEvent, layerIndex: number): void {
    event.preventDefault();
    this.selectLayer(layerIndex);
    this.layerMenu = { x: event.clientX, y: event.clientY, index: layerIndex };
    // Keep the menu fully on screen once its size is known.
    if (this.isBrowser) {
      requestAnimationFrame(() => this.clampLayerMenu());
    }
  }

  private clampLayerMenu(): void {
    const el = this.layerMenuRef?.nativeElement;
    if (!this.layerMenu || !el) return;
    const pad = 8;
    const maxX = window.innerWidth - el.offsetWidth - pad;
    const maxY = window.innerHeight - el.offsetHeight - pad;
    this.layerMenu = {
      ...this.layerMenu,
      x: Math.max(pad, Math.min(this.layerMenu.x, maxX)),
      y: Math.max(pad, Math.min(this.layerMenu.y, maxY)),
    };
  }

  closeLayerMenu(): void {
    this.layerMenu = null;
  }

  // ---- Palette swatch right-click menu ----

  onPaletteContextMenu(event: MouseEvent, index: number): void {
    event.preventDefault();
    this.paletteMenu = { x: event.clientX, y: event.clientY, index };
    if (this.isBrowser) requestAnimationFrame(() => this.clampPaletteMenu());
  }

  private clampPaletteMenu(): void {
    const el = this.paletteMenuRef?.nativeElement;
    if (!this.paletteMenu || !el) return;
    const pad = 8;
    const maxX = window.innerWidth - el.offsetWidth - pad;
    const maxY = window.innerHeight - el.offsetHeight - pad;
    this.paletteMenu = {
      ...this.paletteMenu,
      x: Math.max(pad, Math.min(this.paletteMenu.x, maxX)),
      y: Math.max(pad, Math.min(this.paletteMenu.y, maxY)),
    };
  }

  closePaletteMenu(): void {
    this.paletteMenu = null;
  }

  /** Use the menu's swatch as primary / secondary. */
  paletteMenuSetColor(secondary: boolean): void {
    if (!this.paletteMenu) return;
    const color = this.palette[this.paletteMenu.index];
    if (!color) return;
    if (secondary) this.secondaryColor = color;
    else this.primaryColor = color;
    this.closePaletteMenu();
  }

  /** Open a native colour picker to replace the menu's swatch in place. */
  editPaletteColor(): void {
    const input = this.paletteColorInputRef?.nativeElement;
    if (!this.paletteMenu || !input) return;
    this.paletteEditIndex = this.paletteMenu.index; // survives the menu closing
    input.value = this.normalizeRequiredColor(this.palette[this.paletteMenu.index], '#000000');
    input.click();
  }

  /** Commit the native colour picker's value to the swatch being edited. */
  onPaletteColorEdit(event: Event): void {
    const index = this.paletteEditIndex;
    if (index < 0 || index >= this.palette.length) return;
    const value = (event.target as HTMLInputElement).value;
    const old = this.palette[index];
    this.palette = this.palette.map((c, i) => (i === index ? value : c));
    // Keep primary/secondary pointing at the edited colour if they used it.
    if (old && this.primaryColor.toLowerCase() === old.toLowerCase()) this.primaryColor = value;
    if (old && this.secondaryColor.toLowerCase() === old.toLowerCase()) this.secondaryColor = value;
    this.paletteEditIndex = -1;
    this.closePaletteMenu();
    this.render();
  }

  /** Remove the menu's swatch from the current palette. */
  deletePaletteColor(): void {
    if (!this.paletteMenu) return;
    const index = this.paletteMenu.index;
    this.palette = this.palette.filter((_, i) => i !== index);
    this.closePaletteMenu();
  }

  // ---- Custom dialog (prompt / confirm / alert) ----

  /** Text-input dialog. Resolves to the entered string, or null if cancelled. */
  private askPrompt(opts: {
    title: string;
    message?: string;
    value?: string;
    placeholder?: string;
    okLabel?: string;
  }): Promise<string | null> {
    return new Promise((resolve) => {
      this.dialog = {
        type: 'prompt',
        title: opts.title,
        message: opts.message,
        value: opts.value ?? '',
        placeholder: opts.placeholder,
        okLabel: opts.okLabel ?? 'OK',
        cancelLabel: 'Cancel',
      };
      this.dialogResolve = (v) => resolve(typeof v === 'string' ? v : null);
      if (this.isBrowser) {
        requestAnimationFrame(() => {
          this.dlgInputRef?.nativeElement.focus();
          this.dlgInputRef?.nativeElement.select();
        });
      }
    });
  }

  /** Yes/no dialog. Resolves true on confirm, false otherwise. */
  private askConfirm(opts: {
    title: string;
    message?: string;
    okLabel?: string;
    danger?: boolean;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      this.dialog = {
        type: 'confirm',
        title: opts.title,
        message: opts.message,
        okLabel: opts.okLabel ?? 'OK',
        cancelLabel: 'Cancel',
        danger: opts.danger,
      };
      this.dialogResolve = (v) => resolve(v === true);
    });
  }

  dialogOk(): void {
    const d = this.dialog;
    const resolve = this.dialogResolve;
    this.dialog = null;
    this.dialogResolve = null;
    if (!resolve) return;
    if (d?.type === 'prompt') resolve(d.value ?? '');
    else if (d?.type === 'confirm') resolve(true);
    else resolve(null);
  }

  dialogCancel(): void {
    const d = this.dialog;
    const resolve = this.dialogResolve;
    this.dialog = null;
    this.dialogResolve = null;
    if (!resolve) return;
    resolve(d?.type === 'confirm' ? false : null);
  }

  /** Rename a layer via a prompt (used from the context menu). */
  async renameLayerPrompt(layerIndex: number): Promise<void> {
    const name = await this.askPrompt({
      title: 'Rename layer',
      value: this.layerNameAt(layerIndex),
      placeholder: 'Layer name',
      okLabel: 'Rename',
    });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) layer.name = trimmed;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event?: Event): void {
    if (this.layerMenu) this.layerMenu = null;
    if (this.tagMenu) this.tagMenu = null;
    if (this.groupMenu) this.groupMenu = null;
    if (this.paletteMenu) this.paletteMenu = null;
    // Close the topbar dropdowns when clicking anywhere outside a `.menu`.
    const target = event?.target as HTMLElement | undefined;
    if (target && !target.closest('.menu')) this.closeTopMenus();
  }

  closeTopMenus(): void {
    this.fileMenuOpen = false;
    this.editMenuOpen = false;
    this.exportMenuOpen = false;
    this.panelsMenuOpen = false;
  }

  /** Close the dropdown after an action button is clicked (inputs keep it open). */
  onMenuPick(event: Event): void {
    if ((event.target as HTMLElement).closest('button')) this.closeTopMenus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.layerMenu = null;
    this.tagMenu = null;
    this.groupMenu = null;
    if (this.tf) this.cancelTransform();
    if (this.dialog) this.dialogCancel();
  }

  selectTimelineCell(frameIndex: number, layerIndex: number): void {
    this.flushAdjust();
    this.activeFrameIndex = frameIndex;
    this.previewFrameIndex = frameIndex;
    this.activeLayerIndex = layerIndex;
    this.render();
  }

  layerNameAt(layerIndex: number): string {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) {
        return layer.name;
      }
    }
    return `Layer ${layerIndex + 1}`;
  }

  layerAt(frameIndex: number, layerIndex: number): Layer | null {
    return this.frames[frameIndex]?.layers[layerIndex] ?? null;
  }

  isFrameVisible(frameIndex: number): boolean {
    return this.frames[frameIndex]?.visible ?? true;
  }

  toggleFrameVisibility(frameIndex: number, event?: Event): void {
    event?.stopPropagation();
    const frame = this.frames[frameIndex];
    if (!frame) {
      return;
    }
    frame.visible = !frame.visible;
    if (this.isPlaying && !this.frames.some((item) => item.visible)) {
      this.isPlaying = false;
      window.clearTimeout(this.animationTimer);
    }
    if (this.isPlaying && !this.isFrameVisible(this.previewFrameIndex)) {
      const next = this.findNextVisibleFrameIndex(this.previewFrameIndex);
      this.previewFrameIndex = next;
    }
    this.render();
  }

  cellHasLayer(frameIndex: number, layerIndex: number): boolean {
    return Boolean(this.layerAt(frameIndex, layerIndex));
  }

  isCellVisible(frameIndex: number, layerIndex: number): boolean {
    return this.layerAt(frameIndex, layerIndex)?.visible ?? false;
  }

  isLayerVisible(layerIndex: number): boolean {
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) {
        return layer.visible;
      }
    }
    return true;
  }

  toggleLayerVisibility(layerIndex: number, event?: Event): void {
    event?.stopPropagation();
    const nextVisible = !this.isLayerVisible(layerIndex);
    for (const frame of this.frames) {
      const layer = frame.layers[layerIndex];
      if (layer) {
        layer.visible = nextVisible;
      }
    }
    this.refreshAllFrameThumbnails();
    this.render();
  }

  toggleCellVisibility(
    frameIndex: number,
    layerIndex: number,
    event?: Event,
  ): void {
    event?.stopPropagation();
    const layer = this.layerAt(frameIndex, layerIndex);
    if (!layer) {
      return;
    }
    layer.visible = !layer.visible;
    this.refreshFrameThumbnail(frameIndex);
    this.render();
  }

  addPaletteColor(color = this.primaryColor): void {
    const normalized = color.toLowerCase();
    this.palette = [
      normalized,
      ...this.palette.filter((item) => item.toLowerCase() !== normalized),
    ].slice(0, 64);
  }

  // ===================== HSV color picker =====================

  private rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, max === 0 ? 0 : d / max, max];
  }

  private hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let r = 0;
    let g = 0;
    let b = 0;
    if (h < 60) [r, g] = [c, x];
    else if (h < 120) [r, g] = [x, c];
    else if (h < 180) [g, b] = [c, x];
    else if (h < 240) [g, b] = [x, c];
    else if (h < 300) [r, b] = [x, c];
    else [r, b] = [c, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  /** Current primary as HSV, keeping the picker hue when grayscale. */
  private primaryHsv(): [number, number, number] {
    const [r, g, b] = this.hexToRgb(this.primaryColor);
    const [h, s, v] = this.rgbToHsv(r, g, b);
    return [s > 0.004 ? h : this.pickerHue, s, v];
  }

  get pickerHueDeg(): number {
    return Math.round(this.primaryHsv()[0]);
  }
  get pickerSatPct(): number {
    return this.primaryHsv()[1] * 100;
  }
  get pickerValPct(): number {
    return this.primaryHsv()[2] * 100;
  }
  /** Background for the saturation/value square at the current hue. */
  get svBackground(): string {
    const [r, g, b] = this.hsvToRgb(this.pickerHueDeg, 1, 1);
    return (
      `linear-gradient(to top, #000, rgba(0,0,0,0)),` +
      `linear-gradient(to right, #fff, rgba(255,255,255,0)),` +
      `${this.rgbToHex(r, g, b)}`
    );
  }

  /** Primary as plain #rrggbb (for the native colour input, which has no alpha). */
  get primaryHex6(): string {
    return this.rgbToHex(...this.hexToRgb(this.primaryColor));
  }
  set primaryHex6(v: string) {
    const [r, g, b] = this.hexToRgb(v);
    this.applyPrimaryRgb(r, g, b);
  }

  colorChannel(i: number): number {
    return this.hexToRgb(this.primaryColor)[i];
  }
  setColorChannel(i: number, event: Event): void {
    const rgb = this.hexToRgb(this.primaryColor);
    rgb[i] = this.clamp(
      parseInt((event.target as HTMLInputElement).value, 10) || 0,
      0,
      255,
    );
    this.applyPrimaryRgb(rgb[0], rgb[1], rgb[2]);
  }

  onHexInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim().replace(/^#/, '');
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) {
      this.primaryColor = ('#' + raw).toLowerCase();
      this.pickerAlpha = this.colorAlpha(this.primaryColor);
    }
  }

  /** Set the primary colour from rgb, folding in the current picker alpha. */
  private applyPrimaryRgb(r: number, g: number, b: number): void {
    this.primaryColor = this.withAlpha(this.rgbToHex(r, g, b), this.pickerAlpha);
  }

  setHue(deg: number): void {
    this.pickerHue = deg;
    const [, s, v] = this.primaryHsv();
    const [r, g, b] = this.hsvToRgb(deg, s, v);
    this.applyPrimaryRgb(r, g, b);
  }

  onSvDown(event: PointerEvent): void {
    this.svDragging = true;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.svUpdate(event);
  }
  onSvMove(event: PointerEvent): void {
    if (this.svDragging) this.svUpdate(event);
  }
  onSvUp(event: PointerEvent): void {
    this.svDragging = false;
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  }
  private svUpdate(event: PointerEvent): void {
    const el = event.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const s = this.clamp((event.clientX - r.left) / r.width, 0, 1);
    const v = this.clamp(1 - (event.clientY - r.top) / r.height, 0, 1);
    const [rr, gg, bb] = this.hsvToRgb(this.pickerHueDeg, s, v);
    this.applyPrimaryRgb(rr, gg, bb);
  }

  // ----- HSV / HSL sliders, alpha, shades -----

  /** Apply HSV directly (used by the H/S/B sliders). */
  private applyHsv(h: number, s: number, v: number): void {
    const [r, g, b] = this.hsvToRgb(h, this.clamp(s, 0, 1), this.clamp(v, 0, 1));
    if (s > 0.004) this.pickerHue = h;
    this.applyPrimaryRgb(r, g, b);
  }
  setSat(pct: number): void {
    const [h, , v] = this.primaryHsv();
    this.applyHsv(h, pct / 100, v);
  }
  setVal(pct: number): void {
    const [h, s] = this.primaryHsv();
    this.applyHsv(h, s, pct / 100);
  }

  private rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
    }
    return [h, s, l];
  }
  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g] = [c, x];
    else if (h < 120) [r, g] = [x, c];
    else if (h < 180) [g, b] = [c, x];
    else if (h < 240) [g, b] = [x, c];
    else if (h < 300) [r, b] = [x, c];
    else [r, b] = [c, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  private primaryHsl(): [number, number, number] {
    const [r, g, b] = this.hexToRgb(this.primaryColor);
    const [h, s, l] = this.rgbToHsl(r, g, b);
    return [s > 0.004 ? h : this.pickerHue, s, l];
  }
  get pickerHslSatPct(): number { return this.primaryHsl()[1] * 100; }
  get pickerHslLightPct(): number { return this.primaryHsl()[2] * 100; }
  private applyHsl(h: number, s: number, l: number): void {
    const [r, g, b] = this.hslToRgb(h, this.clamp(s, 0, 1), this.clamp(l, 0, 1));
    if (s > 0.004) this.pickerHue = h;
    this.applyPrimaryRgb(r, g, b);
  }
  setHslSat(pct: number): void {
    const [h, , l] = this.primaryHsl();
    this.applyHsl(h, pct / 100, l);
  }
  setHslLight(pct: number): void {
    const [h, s] = this.primaryHsl();
    this.applyHsl(h, s, pct / 100);
  }

  /** Gradient track background for a slider as its value sweeps min→max. */
  hueTrack(): string {
    return 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';
  }
  satTrack(): string {
    const [h, , v] = this.primaryHsv();
    const a = this.rgbToHex(...this.hsvToRgb(h, 0, v));
    const b = this.rgbToHex(...this.hsvToRgb(h, 1, v));
    return `linear-gradient(to right, ${a}, ${b})`;
  }
  valTrack(): string {
    const [h, s] = this.primaryHsv();
    const b = this.rgbToHex(...this.hsvToRgb(h, s, 1));
    return `linear-gradient(to right, #000, ${b})`;
  }
  lightTrack(): string {
    const [h, s] = this.primaryHsl();
    const mid = this.rgbToHex(...this.hslToRgb(h, s, 0.5));
    return `linear-gradient(to right, #000, ${mid}, #fff)`;
  }
  get alphaTrack(): string {
    const base = this.rgbToHex(...this.hexToRgb(this.primaryColor));
    return `linear-gradient(to right, rgba(0,0,0,0), ${base})`;
  }

  // ----- Alpha -----
  get pickerAlphaPct(): number {
    return Math.round((this.pickerAlpha / 255) * 100);
  }
  setAlpha(pct: number): void {
    this.pickerAlpha = this.clamp(Math.round((pct / 100) * 255), 0, 255);
    this.primaryColor = this.withAlpha(this.primaryColor, this.pickerAlpha);
  }

  // ----- Shades & tints -----
  /** 9 brightness variants (dark→light) of the primary, keeping hue/sat/alpha. */
  get shadeSwatches(): string[] {
    const [h, s] = this.primaryHsv();
    return Array.from({ length: 9 }, (_, i) => {
      const v = (i + 1) / 9;
      return this.withAlpha(this.rgbToHex(...this.hsvToRgb(h, s, v)), this.pickerAlpha);
    });
  }
  /** 9 saturation variants (gray→vivid) of the primary at its brightness. */
  get tintSwatches(): string[] {
    const [h, , v] = this.primaryHsv();
    return Array.from({ length: 9 }, (_, i) => {
      const s = i / 8;
      return this.withAlpha(this.rgbToHex(...this.hsvToRgb(h, s, v)), this.pickerAlpha);
    });
  }
  pickVariant(hex: string): void {
    this.primaryColor = hex;
    this.pickerAlpha = this.colorAlpha(hex);
  }

  // ===================== Palette helpers & tools =====================

  /** Pick primary/secondary from a swatch and remember the choice. */
  selectPrimary(color: string): void {
    this.primaryColor = color;
    this.pickerAlpha = this.colorAlpha(color);
    this.pushRecent(color);
  }

  private pushRecent(color: string): void {
    const c = color.toLowerCase();
    this.recentColors = [c, ...this.recentColors.filter((x) => x !== c)].slice(
      0,
      14,
    );
  }

  private dedupeColors(colors: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of colors) {
      const k = c.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out;
  }

  sortPalette(by: 'hue' | 'lum'): void {
    this.palette = [...this.palette].sort(
      (a, b) => this.colorSortKey(a, by) - this.colorSortKey(b, by),
    );
  }
  private colorSortKey(hex: string, by: 'hue' | 'lum'): number {
    const [r, g, b] = this.hexToRgb(hex);
    if (by === 'lum') return 0.299 * r + 0.587 * g + 0.114 * b;
    const [h, s, v] = this.rgbToHsv(r, g, b);
    // Group greys (no hue) at the end so the ramp reads cleanly.
    return s < 0.05 ? 360 + v : h;
  }

  /** Append a primary→secondary gradient ramp to the palette. */
  addGradientToPalette(steps = 6): void {
    const [r1, g1, b1] = this.hexToRgb(this.primaryColor);
    const [r2, g2, b2] = this.hexToRgb(this.secondaryColor);
    const ramp: string[] = [];
    for (let i = 0; i < steps; i += 1) {
      const t = steps === 1 ? 0 : i / (steps - 1);
      ramp.push(
        this.rgbToHex(
          r1 + (r2 - r1) * t,
          g1 + (g2 - g1) * t,
          b1 + (b2 - b1) * t,
        ),
      );
    }
    this.palette = this.dedupeColors([...this.palette, ...ramp]).slice(0, 64);
  }

  /** Append harmony colours (complementary + analogous + triad) of the primary. */
  addHarmonyToPalette(): void {
    const [r, g, b] = this.hexToRgb(this.primaryColor);
    const [h, s, v] = this.rgbToHsv(r, g, b);
    const ss = Math.max(0.25, s);
    const vv = Math.max(0.25, v);
    const hues = [180, 30, 330, 120, 240].map((d) => (h + d) % 360);
    const cols = hues.map((hh) => {
      const [cr, cg, cb] = this.hsvToRgb(hh, ss, vv);
      return this.rgbToHex(cr, cg, cb);
    });
    this.palette = this.dedupeColors([this.primaryColor, ...this.palette, ...cols]).slice(0, 64);
  }

  /** Nearest palette colour to a hex (ignores palette-lock state). */
  private nearestPaletteHex(hex: string): string {
    if (!this.palette.length) return hex;
    const [r, g, b] = this.hexToRgb(hex);
    let best = this.palette[0];
    let bestD = Infinity;
    for (const c of this.palette) {
      const [cr, cg, cb] = this.hexToRgb(c);
      const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** Recolour the whole sprite to the nearest colours in the current palette. */
  remapToPalette(): void {
    if (!this.palette.length) return;
    this.pushUndo();
    const cache = new Map<string, string>();
    for (const frame of this.frames) {
      for (const layer of frame.layers) {
        for (let i = 0; i < layer.pixels.length; i += 1) {
          const c = layer.pixels[i];
          if (!c) continue;
          let mapped = cache.get(c);
          if (mapped === undefined) {
            mapped = this.nearestPaletteHex(c);
            cache.set(c, mapped);
          }
          layer.pixels[i] = mapped;
        }
      }
    }
    this.refreshAllFrameThumbnails();
    this.render();
  }

  // ----- Colour adjustments (Hue / Saturation / Brightness) -----

  /** A live adjust session is in progress (base captured, preview shown). */
  adjustActive = false;
  adjustHue = 0;
  adjustSat = 0;
  adjustBright = 0;
  // Brightness / Contrast (-100..100)
  adjustBrightness = 0;
  adjustContrast = 0;
  // Shadows / Highlights (-100..100)
  adjustShadows = 0;
  adjustHighlights = 0;
  // Levels — per-channel (Photoshop-style). 'rgb' applies to all channels;
  // r/g/b stack on top of it for that single channel.
  levelChannel: 'rgb' | 'r' | 'g' | 'b' = 'rgb';
  levels: Record<'rgb' | 'r' | 'g' | 'b', LevelCh> = {
    rgb: { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 },
    r: { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 },
    g: { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 },
    b: { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 },
  };
  /** Histogram bars (normalized 0..1) for the active channel — drawn as an SVG. */
  histBars: number[] = [];
  // Curves — per-channel control points (input/output 0..255), endpoints anchored.
  curveChannel: 'rgb' | 'r' | 'g' | 'b' = 'rgb';
  curves: Record<'rgb' | 'r' | 'g' | 'b', { x: number; y: number }[]> = {
    rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    b: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  };
  /** Cached 256-entry lookup tables per channel (null = identity / skip). */
  private curveLuts: Record<'rgb' | 'r' | 'g' | 'b', number[] | null> = {
    rgb: null, r: null, g: null, b: null,
  };
  adjustScope: 'layer' | 'selection' = 'layer';
  adjustTab: 'hsb' | 'bc' | 'sh' | 'levels' | 'curves' = 'bc';
  private adjustBase: Pixel[] | null = null;
  /** Controls were touched since the last bake — avoids redundant undo entries. */
  private adjustDirty = false;

  /** Edit ▾ → Adjustments: reveal the dock panel and start a fresh session. */
  openAdjust(): void {
    this.editMenuOpen = false;
    if (this.activeLayerLocked) {
      this.notify.info(this.locale.t('notify.layerLocked'));
      return;
    }
    this.floatAdjust();
    this.beginAdjust(true);
  }

  /** Reveal the Adjust panel as a floating window over the canvas (not docked). */
  private floatAdjust(): void {
    if (this.dock.isFloating('adjust')) {
      if (this.dock.isCollapsed('adjust')) this.dock.toggleCollapse('adjust');
      this.dock.bringToFront('adjust');
      return;
    }
    const host = this.hostRef.nativeElement.getBoundingClientRect();
    const w = 320;
    const h = 440;
    const x = this.clamp(host.width - w - 24, 8, Math.max(8, host.width - w - 8));
    const y = this.clamp(80, 8, Math.max(8, host.height - 80));
    this.dock.float('adjust', { x, y, w, h });
  }

  /** Capture the current layer as the adjust base (optionally zero the sliders). */
  private beginAdjust(reset: boolean): void {
    if (reset) this.resetAdjustValues();
    this.adjustScope = this.selection ? 'selection' : 'layer';
    this.adjustBase = [...this.activeLayer.pixels];
    this.adjustActive = true;
    this.adjustDirty = false;
    this.computeHistogram();
    this.applyAdjustPreview();
  }

  /** A slider / scope changed in the panel — ensure a session, then live-preview. */
  onAdjustChange(): void {
    if (this.activeLayerLocked) return;
    if (!this.adjustActive) this.beginAdjust(false);
    else this.applyAdjustPreview();
    this.adjustDirty = true;
  }

  /** Auto-commit + end the session before drawing / switching layer-frame-tab. */
  private flushAdjust(): void {
    if (!this.adjustActive) return;
    this.bakeAdjust();
    this.endAdjust();
  }

  private resetAdjustValues(): void {
    this.adjustHue = 0;
    this.adjustSat = 0;
    this.adjustBright = 0;
    this.adjustBrightness = 0;
    this.adjustContrast = 0;
    this.adjustShadows = 0;
    this.adjustHighlights = 0;
    for (const ch of ['rgb', 'r', 'g', 'b'] as const) {
      this.levels[ch] = { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 };
      this.curves[ch] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];
      this.curveLuts[ch] = null;
    }
  }

  resetAdjust(): void {
    this.resetAdjustValues();
    this.adjustDirty = true;
    this.applyAdjustPreview();
  }

  /** The Levels params for the channel currently selected in the panel. */
  get curLevel(): LevelCh { return this.levels[this.levelChannel]; }

  /** Value (0..255) → percent across the track. */
  lvlPos(v: number): number { return this.clamp(v / 255, 0, 1) * 100; }

  /** Screen position (percent) of the gamma (midtone) handle. */
  get gammaPos(): number {
    const L = this.curLevel;
    return this.clamp((L.inB + (L.inW - L.inB) * Math.pow(0.5, L.gamma)) / 255, 0, 1) * 100;
  }

  /** SVG area path for the active channel's histogram (viewBox 0 0 256 100). */
  get histPath(): string {
    const b = this.histBars;
    if (!b.length) return '';
    const step = 256 / b.length;
    let d = 'M0,100';
    for (let i = 0; i < b.length; i += 1) {
      d += ` L${(i * step).toFixed(1)},${(100 - b[i] * 100).toFixed(1)}`;
    }
    return d + ' L256,100 Z';
  }

  /** Histogram channel for whichever tab (Levels / Curves) is showing. */
  private histChannel(): 'rgb' | 'r' | 'g' | 'b' {
    return this.adjustTab === 'curves' ? this.curveChannel : this.levelChannel;
  }

  /** Recompute the histogram (128 bins) for the active channel + scope. */
  private computeHistogram(): void {
    const px = this.adjustBase ?? this.activeLayer?.pixels;
    if (!px) { this.histBars = []; return; }
    const bins = new Array(128).fill(0);
    const ch = this.histChannel();
    const tally = (hex: string) => {
      const [r, g, b] = this.hexToRgb(hex);
      const v = ch === 'r' ? r : ch === 'g' ? g : ch === 'b' ? b : 0.299 * r + 0.587 * g + 0.114 * b;
      bins[Math.min(127, Math.max(0, Math.floor(v / 2)))] += 1;
    };
    if (this.adjustScope === 'selection' && this.selection) {
      this.eachSelectionPixel(this.selection, (x, y) => { const c = px[this.index(x, y)]; if (c) tally(c); });
    } else {
      for (const c of px) if (c) tally(c);
    }
    const max = Math.max(1, ...bins);
    this.histBars = bins.map((v) => v / max);
  }

  /** Switch the active Levels channel and redraw its histogram. */
  setLevelChannel(ch: 'rgb' | 'r' | 'g' | 'b'): void {
    this.levelChannel = ch;
    this.computeHistogram();
  }

  /** Show the Levels tab and ensure its histogram reflects the current pixels. */
  openLevelsTab(): void {
    this.adjustTab = 'levels';
    this.computeHistogram();
  }

  /** Change adjust scope (layer/selection) — refresh histogram + preview. */
  setAdjustScope(s: 'layer' | 'selection'): void {
    this.adjustScope = s;
    this.computeHistogram();
    this.onAdjustChange();
  }

  // Dragging a Levels handle (triangle) directly on the histogram / output bar.
  private histDragWhich: 'inB' | 'gamma' | 'inW' | 'outB' | 'outW' | null = null;
  private histTrackEl: HTMLElement | null = null;

  startHistDrag(which: 'inB' | 'gamma' | 'inW' | 'outB' | 'outW', ev: PointerEvent): void {
    ev.preventDefault();
    this.histDragWhich = which;
    this.histTrackEl = (ev.target as HTMLElement).closest('.lvl-track') as HTMLElement;
    const move = (e: PointerEvent) => this.histDragMove(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.histDragWhich = null;
      this.histTrackEl = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private histDragMove(e: PointerEvent): void {
    if (!this.histDragWhich || !this.histTrackEl) return;
    const r = this.histTrackEl.getBoundingClientRect();
    const v = Math.round(this.clamp((e.clientX - r.left) / r.width, 0, 1) * 255);
    const L = this.curLevel;
    switch (this.histDragWhich) {
      case 'inB': L.inB = Math.min(v, L.inW - 1); break;
      case 'inW': L.inW = Math.max(v, L.inB + 1); break;
      case 'gamma': {
        const f = this.clamp((v - L.inB) / Math.max(1, L.inW - L.inB), 0.001, 0.999);
        L.gamma = this.clamp(Math.log(f) / Math.log(0.5), 0.1, 9.99);
        break;
      }
      case 'outB': L.outB = Math.min(v, L.outW - 1); break;
      case 'outW': L.outW = Math.max(v, L.outB + 1); break;
    }
    this.onAdjustChange();
  }

  // ----- Curves -----

  /** Control points for the channel currently selected in the Curves tab. */
  get curPts(): { x: number; y: number }[] { return this.curves[this.curveChannel]; }

  private isIdentityCurve(p: { x: number; y: number }[]): boolean {
    return p.length === 2 && p[0].x === 0 && p[0].y === 0 && p[1].x === 255 && p[1].y === 255;
  }

  setCurveChannel(ch: 'rgb' | 'r' | 'g' | 'b'): void {
    this.curveChannel = ch;
    this.computeHistogram();
  }

  openCurvesTab(): void {
    this.adjustTab = 'curves';
    this.computeHistogram();
  }

  /** SVG path for the histogram backdrop of the curve editor (viewBox 0 0 256 256). */
  get curveHistPath(): string {
    const b = this.histBars;
    if (!b.length) return '';
    const step = 256 / b.length;
    let d = 'M0,256';
    for (let i = 0; i < b.length; i += 1) {
      d += ` L${(i * step).toFixed(1)},${(256 - b[i] * 90).toFixed(1)}`;
    }
    return d + ' L256,256 Z';
  }

  /** SVG path of the active channel's curve (y inverted: output up). */
  get curvePath(): string {
    const lut = this.curveLuts[this.curveChannel];
    let d = '';
    for (let i = 0; i < 256; i += 1) {
      d += (i ? ' L' : 'M') + i + ',' + (255 - (lut ? lut[i] : i));
    }
    return d;
  }

  /** Build a smooth monotone-cubic (PCHIP) 256-entry LUT through the points. */
  private buildCurveLut(pts: { x: number; y: number }[]): number[] {
    const p = [...pts].sort((a, b) => a.x - b.x);
    const n = p.length;
    const lut = new Array(256);
    if (n === 1) { lut.fill(this.clamp(Math.round(p[0].y), 0, 255)); return lut; }
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    const dx: number[] = [], dy: number[] = [], m: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      dx[i] = (xs[i + 1] - xs[i]) || 1;
      dy[i] = ys[i + 1] - ys[i];
      m[i] = dy[i] / dx[i];
    }
    const t: number[] = new Array(n);
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i += 1) {
      t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    }
    // Fritsch–Carlson limiter keeps the spline monotone (no overshoot ringing).
    for (let i = 0; i < n - 1; i += 1) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], bb = t[i + 1] / m[i];
      const h = Math.hypot(a, bb);
      if (h > 3) { const tau = 3 / h; t[i] = tau * a * m[i]; t[i + 1] = tau * bb * m[i]; }
    }
    for (let xi = 0; xi < 256; xi += 1) {
      if (xi <= xs[0]) { lut[xi] = this.clamp(Math.round(ys[0]), 0, 255); continue; }
      if (xi >= xs[n - 1]) { lut[xi] = this.clamp(Math.round(ys[n - 1]), 0, 255); continue; }
      let s = 0;
      while (s < n - 1 && !(xi >= xs[s] && xi <= xs[s + 1])) s += 1;
      const h = dx[s], u = (xi - xs[s]) / h;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
      const h10 = u ** 3 - 2 * u ** 2 + u;
      const h01 = -2 * u ** 3 + 3 * u ** 2;
      const h11 = u ** 3 - u ** 2;
      const v = h00 * ys[s] + h10 * h * t[s] + h01 * ys[s + 1] + h11 * h * t[s + 1];
      lut[xi] = this.clamp(Math.round(v), 0, 255);
    }
    return lut;
  }

  /** Recompute the current channel's LUT and live-preview. */
  private curveChanged(): void {
    this.curveLuts[this.curveChannel] = this.isIdentityCurve(this.curPts)
      ? null
      : this.buildCurveLut(this.curPts);
    this.onAdjustChange();
  }

  removeCurvePoint(i: number): void {
    const pts = this.curPts;
    if (i <= 0 || i >= pts.length - 1) return; // endpoints stay
    pts.splice(i, 1);
    this.curveChanged();
  }

  private curveSvgEl: SVGElement | null = null;
  private curveDragIdx = -1;

  private svgToVal(svg: SVGElement, e: PointerEvent): { x: number; y: number } {
    const r = svg.getBoundingClientRect();
    return {
      x: this.clamp(Math.round(((e.clientX - r.left) / r.width) * 255), 0, 255),
      y: this.clamp(Math.round((1 - (e.clientY - r.top) / r.height) * 255), 0, 255),
    };
  }

  /** Pointer-down on an existing control point → start dragging it. */
  startCurveDrag(i: number, ev: PointerEvent): void {
    ev.stopPropagation();
    ev.preventDefault();
    this.beginCurveDrag((ev.target as Element).closest('svg') as SVGElement, i, ev);
  }

  /** Pointer-down on empty editor area → insert a point and drag it. */
  curveAddPoint(ev: PointerEvent): void {
    const svg = ev.currentTarget as SVGElement;
    const { x, y } = this.svgToVal(svg, ev);
    const pts = this.curPts;
    let idx = pts.findIndex((p) => Math.abs(p.x - x) <= 4);
    if (idx < 0) {
      pts.push({ x, y });
      pts.sort((a, b) => a.x - b.x);
      idx = pts.findIndex((p) => p.x === x);
    }
    this.beginCurveDrag(svg, idx, ev);
    this.curveChanged();
  }

  private beginCurveDrag(svg: SVGElement, index: number, _ev: PointerEvent): void {
    this.curveSvgEl = svg;
    this.curveDragIdx = index;
    const move = (e: PointerEvent) => this.curveDragMove(e);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.curveSvgEl = null;
      this.curveDragIdx = -1;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  private curveDragMove(e: PointerEvent): void {
    if (!this.curveSvgEl || this.curveDragIdx < 0) return;
    const pts = this.curPts;
    const i = this.curveDragIdx;
    const { x, y } = this.svgToVal(this.curveSvgEl, e);
    let nx = x;
    if (i === 0) nx = 0;
    else if (i === pts.length - 1) nx = 255;
    else nx = this.clamp(x, pts[i - 1].x + 1, pts[i + 1].x - 1);
    pts[i] = { x: nx, y };
    this.curveChanged();
  }

  applyAdjustPreview(): void {
    if (!this.adjustBase) return;
    const buf = [...this.adjustBase];
    const apply = (x: number, y: number) => {
      const i = this.index(x, y);
      const c = buf[i];
      if (c) buf[i] = this.adjustPixel(c);
    };
    if (this.adjustScope === 'selection' && this.selection) {
      this.eachSelectionPixel(this.selection, apply);
    } else {
      for (let i = 0; i < buf.length; i += 1) {
        if (buf[i]) buf[i] = this.adjustPixel(buf[i]!);
      }
    }
    this.previewPixels = buf;
    this.render();
  }

  private adjustPixel(hex: string): string {
    let [r, g, b] = this.hexToRgb(hex);
    const a = this.colorAlpha(hex);

    // 1) Levels — composite (rgb) then per-channel remap with gamma.
    const isIdentity = (L: LevelCh) =>
      L.inB === 0 && L.inW === 255 && L.gamma === 1 && L.outB === 0 && L.outW === 255;
    const remap = (vv: number, L: LevelCh) => {
      const n = Math.pow(this.clamp((vv - L.inB) / Math.max(1, L.inW - L.inB), 0, 1), 1 / L.gamma);
      return L.outB + n * (L.outW - L.outB);
    };
    const rgbL = this.levels.rgb;
    if (!isIdentity(rgbL)) {
      r = remap(r, rgbL); g = remap(g, rgbL); b = remap(b, rgbL);
    }
    if (!isIdentity(this.levels.r)) r = remap(r, this.levels.r);
    if (!isIdentity(this.levels.g)) g = remap(g, this.levels.g);
    if (!isIdentity(this.levels.b)) b = remap(b, this.levels.b);

    // 1.5) Curves — composite (rgb) then per-channel LUT remap.
    const cl = this.curveLuts;
    if (cl.rgb || cl.r || cl.g || cl.b) {
      const ap = (v: number, lut: number[] | null) =>
        lut ? lut[this.clamp(Math.round(v), 0, 255)] : v;
      if (cl.rgb) { r = ap(r, cl.rgb); g = ap(g, cl.rgb); b = ap(b, cl.rgb); }
      r = ap(r, cl.r); g = ap(g, cl.g); b = ap(b, cl.b);
    }

    // 2) Brightness / Contrast.
    if (this.adjustBrightness || this.adjustContrast) {
      const br = (this.adjustBrightness / 100) * 127;
      const c = (this.adjustContrast / 100) * 255;
      const f = (259 * (c + 255)) / (255 * (259 - c));
      const bc = (vv: number) => f * (vv + br - 128) + 128;
      r = bc(r); g = bc(g); b = bc(b);
    }

    // 3) Shadows / Highlights — luminance-masked gain (PS sign convention).
    if (this.adjustShadows || this.adjustHighlights) {
      const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const sMask = this.clamp(1 - L * 2, 0, 1);
      const hMask = this.clamp(L * 2 - 1, 0, 1);
      const gain =
        1 + (this.adjustShadows / 100) * sMask - (this.adjustHighlights / 100) * hMask;
      r *= gain; g *= gain; b *= gain;
    }

    // 4) HSB (hue / saturation / brightness).
    if (this.adjustHue || this.adjustSat || this.adjustBright) {
      let [h, s, v] = this.rgbToHsv(
        this.clamp(r, 0, 255), this.clamp(g, 0, 255), this.clamp(b, 0, 255),
      );
      h = (h + this.adjustHue + 360) % 360;
      s = this.clamp(s * (1 + this.adjustSat / 100), 0, 1);
      v = this.clamp(v * (1 + this.adjustBright / 100), 0, 1);
      [r, g, b] = this.hsvToRgb(h, s, v);
    }

    return this.withAlpha(this.rgbToHex(r, g, b), a);
  }

  /** Bake the current preview into the active layer (no session change). */
  private bakeAdjust(): void {
    if (!this.adjustActive || !this.adjustBase || !this.adjustDirty) return;
    this.applyAdjustPreview();
    if (this.previewPixels) {
      this.pushUndo();
      this.activeLayer.pixels = [...this.previewPixels];
      this.refreshAllFrameThumbnails();
    }
    this.adjustDirty = false;
  }

  /** End the session: drop the preview/base and reset the controls. */
  private endAdjust(): void {
    this.previewPixels = null;
    this.adjustBase = null;
    this.adjustActive = false;
    this.adjustDirty = false;
    this.resetAdjustValues();
    this.render();
  }

  /**
   * Apply button: bake the result into the layer but KEEP the session and the
   * control values so the user can keep tuning. The base stays the original
   * pixels, so re-previewing never double-applies.
   */
  commitAdjust(): void {
    this.bakeAdjust();
    this.previewPixels = null;
    this.render();
  }

  /** Discard the preview and end the session (sliders back to neutral). */
  cancelAdjust(): void {
    this.endAdjust();
  }

  /** Build the palette from the distinct colours used in the active frame. */
  extractPaletteFromSprite(): void {
    const seen = new Set<string>();
    for (const layer of this.activeFrame.layers) {
      if (!layer.visible) continue;
      for (const px of layer.pixels) {
        if (px) seen.add(px.toLowerCase());
        if (seen.size >= 64) break;
      }
    }
    if (seen.size) this.palette = [...seen].slice(0, 64);
  }

  /** Build the palette from the colours inside the current selection only. */
  extractPaletteFromSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    const seen = new Set<string>();
    this.eachSelectionPixel(sel, (x, y) => {
      const i = this.index(x, y);
      for (const layer of this.activeFrame.layers) {
        if (!layer.visible) continue;
        const px = layer.pixels[i];
        if (px) seen.add(px.toLowerCase());
      }
    });
    if (seen.size) this.palette = [...seen].slice(0, 64);
  }

  // ===================== Tilemap editor =====================

  get tileColumns(): number {
    return Math.max(1, Math.floor(this.width / this.tileSize));
  }
  get tileRowsCount(): number {
    return Math.max(1, Math.floor(this.height / this.tileSize));
  }
  get tileCount(): number {
    return this.tileColumns * this.tileRowsCount;
  }

  /** Slice the active frame into tiles and rebuild the tileset thumbnails. */
  refreshTiles(): void {
    if (!this.isBrowser) return;
    this.tileSrcCanvas = this.renderFrameCanvas(this.activeFrameIndex, 1);
    const ts = this.tileSize;
    const cols = this.tileColumns;
    const rows = this.tileRowsCount;
    const thumbs: string[] = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const t = document.createElement('canvas');
        t.width = ts;
        t.height = ts;
        const tc = t.getContext('2d');
        if (!tc) continue;
        tc.imageSmoothingEnabled = false;
        tc.drawImage(this.tileSrcCanvas, c * ts, r * ts, ts, ts, 0, 0, ts, ts);
        thumbs.push(t.toDataURL());
      }
    }
    this.tileThumbs = thumbs;
    if (this.selectedTile >= thumbs.length) this.selectedTile = 0;
  }

  private ensureTilemapCells(): void {
    const want = this.tileMapCols * this.tileMapRows;
    if (this.tileMapCells.length !== want) {
      this.tileMapCells = new Array<number>(want).fill(-1);
    }
    if (this.tileMapFilled.length !== want) {
      this.tileMapFilled = new Array<boolean>(want).fill(false);
    }
  }

  selectTile(i: number): void {
    this.selectedTile = i;
  }

  /** Apply tile-size / map-size changes, then re-slice and re-render. */
  onTilemapConfigChange(): void {
    this.tileSize = this.clamp(Math.floor(this.tileSize) || 16, 2, 64);
    this.tileMapCols = this.clamp(Math.floor(this.tileMapCols) || 1, 1, 128);
    this.tileMapRows = this.clamp(Math.floor(this.tileMapRows) || 1, 1, 128);
    this.tilemapScale = this.clamp(Math.floor(this.tilemapScale) || 16, 4, 48);
    this.refreshTiles();
    const n = this.tileMapCols * this.tileMapRows;
    this.tileMapCells = new Array<number>(n).fill(-1);
    this.tileMapFilled = new Array<boolean>(n).fill(false);
    this.renderTilemap();
  }

  clearTilemap(): void {
    const n = this.tileMapCols * this.tileMapRows;
    this.tileMapCells = new Array<number>(n).fill(-1);
    this.tileMapFilled = new Array<boolean>(n).fill(false);
    this.renderTilemap();
  }

  renderTilemap(): void {
    const cv = this.tilemapRef?.nativeElement;
    const ctx = this.tilemapCtx;
    if (!cv || !ctx) return;
    if (!this.tileSrcCanvas) this.refreshTiles();
    this.ensureTilemapCells();
    const s = this.tilemapScale;
    const cols = this.tileMapCols;
    const rows = this.tileMapRows;
    const ts = this.tileSize;
    const tcols = this.tileColumns;
    cv.width = cols * s;
    cv.height = rows * s;
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#222a35' : '#1b212b';
        ctx.fillRect(x * s, y * s, s, s);
      }
    }
    for (let i = 0; i < this.tileMapCells.length; i += 1) {
      const idx = this.tileMapCells[i];
      if (idx < 0 || idx >= this.tileCount || !this.tileSrcCanvas) continue;
      const cx = (i % cols) * s;
      const cy = Math.floor(i / cols) * s;
      const tx = (idx % tcols) * ts;
      const ty = Math.floor(idx / tcols) * ts;
      ctx.drawImage(this.tileSrcCanvas, tx, ty, ts, ts, cx, cy, s, s);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x += 1) {
      ctx.beginPath();
      ctx.moveTo(x * s + 0.5, 0);
      ctx.lineTo(x * s + 0.5, rows * s);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y += 1) {
      ctx.beginPath();
      ctx.moveTo(0, y * s + 0.5);
      ctx.lineTo(cols * s, y * s + 0.5);
      ctx.stroke();
    }
  }

  onTilemapDown(event: PointerEvent): void {
    event.preventDefault();
    this.tilemapPainting = true;
    this.tilemapErase = event.button === 2 || event.altKey;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.paintTilemap(event);
  }
  onTilemapMove(event: PointerEvent): void {
    if (this.tilemapPainting) this.paintTilemap(event);
  }
  onTilemapUp(event: PointerEvent): void {
    this.tilemapPainting = false;
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  }
  private paintTilemap(event: PointerEvent): void {
    const cv = this.tilemapRef?.nativeElement;
    if (!cv) return;
    const r = cv.getBoundingClientRect();
    const s = this.tilemapScale;
    const x = Math.floor((event.clientX - r.left) / s);
    const y = Math.floor((event.clientY - r.top) / s);
    if (x < 0 || y < 0 || x >= this.tileMapCols || y >= this.tileMapRows) return;
    const i = y * this.tileMapCols + x;

    if (this.tileMapAuto && this.autoTileReady) {
      const fill = !this.tilemapErase;
      if (this.tileMapFilled[i] === fill && (fill || this.tileMapCells[i] < 0)) {
        return; // no change
      }
      this.tileMapFilled[i] = fill;
      if (!fill) this.tileMapCells[i] = -1;
      // Recompute this cell and its 4 cardinal neighbours.
      this.recomputeAutoTile(x, y);
      this.recomputeAutoTile(x, y - 1);
      this.recomputeAutoTile(x + 1, y);
      this.recomputeAutoTile(x, y + 1);
      this.recomputeAutoTile(x - 1, y);
      this.renderTilemap();
      return;
    }

    const val = this.tilemapErase ? -1 : this.selectedTile;
    if (this.tileMapCells[i] !== val) {
      this.tileMapCells[i] = val;
      this.tileMapFilled[i] = false; // manual cell, not part of the auto group
      this.renderTilemap();
    }
  }

  /** Auto-tiling needs a 16-tile block starting at the selected tile. */
  get autoTileReady(): boolean {
    return this.selectedTile >= 0 && this.selectedTile + 16 <= this.tileCount;
  }

  private autoFilledAt(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.tileMapCols || y >= this.tileMapRows) {
      return false; // out of bounds reads as an edge (border tiles appear)
    }
    return this.tileMapFilled[y * this.tileMapCols + x];
  }

  /** Pick the variant for an auto cell from its cardinal neighbours. */
  private recomputeAutoTile(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= this.tileMapCols || y >= this.tileMapRows) return;
    const i = y * this.tileMapCols + x;
    if (!this.tileMapFilled[i]) return; // only auto cells get a computed variant
    const mask =
      (this.autoFilledAt(x, y - 1) ? 1 : 0) | // N
      (this.autoFilledAt(x + 1, y) ? 2 : 0) | // E
      (this.autoFilledAt(x, y + 1) ? 4 : 0) | // S
      (this.autoFilledAt(x - 1, y) ? 8 : 0); // W
    this.tileMapCells[i] = this.selectedTile + mask;
  }

  /** Export the painted map as PNG + the tileset PNG + a JSON map (Pro). */
  async exportTilemap(): Promise<void> {
    if (!(await this.requirePro('Tilemap export'))) return;
    this.refreshTiles();
    const ts = this.tileSize;
    const cols = this.tileMapCols;
    const rows = this.tileMapRows;
    const tcols = this.tileColumns;
    const map = document.createElement('canvas');
    map.width = cols * ts;
    map.height = rows * ts;
    const ctx = map.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < this.tileMapCells.length; i += 1) {
      const idx = this.tileMapCells[i];
      if (idx < 0 || idx >= this.tileCount || !this.tileSrcCanvas) continue;
      const cx = (i % cols) * ts;
      const cy = Math.floor(i / cols) * ts;
      const tx = (idx % tcols) * ts;
      const ty = Math.floor(idx / tcols) * ts;
      ctx.drawImage(this.tileSrcCanvas, tx, ty, ts, ts, cx, cy, ts, ts);
    }
    const base = this.exportBaseName();
    this.stampWatermark(ctx, map.width, map.height);
    this.downloadCanvas(map, `${base}-tilemap.png`);
    if (this.tileSrcCanvas) {
      this.downloadCanvas(this.tileSrcCanvas, `${base}-tileset.png`);
    }
    const json = {
      app: 'Pixel Art Studio',
      type: 'tilemap',
      tileWidth: ts,
      tileHeight: ts,
      columns: cols,
      rows,
      tileset: {
        image: `${base}-tileset.png`,
        tileWidth: ts,
        tileHeight: ts,
        columns: tcols,
        rows: this.tileRowsCount,
        count: this.tileCount,
      },
      data: this.tileMapCells,
    };
    this.downloadBlob(
      new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }),
      `${base}-tilemap.json`,
    );
  }

  // ===================== Palette management =====================

  /** Replace the working palette and select its first colour. */
  loadPalette(colors: string[]): void {
    if (!colors.length) return;
    this.palette = [...colors];
    this.primaryColor = colors[0];
    if (colors.length > 1) this.secondaryColor = colors[1];
    this.render();
  }

  togglePaletteLock(): void {
    this.paletteLock = !this.paletteLock;
  }

  /** Load a palette chosen from the dropdown (value 'b:id' built-in / 's:id' saved). */
  onPaletteSelect(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (!value) return;
    const id = value.slice(2);
    const source = value[0] === 'b' ? this.builtinPalettes : this.savedPalettes;
    const found = source.find((p) => p.id === id);
    if (found) this.loadPalette(found.colors);
  }

  setDither(mode: 'off' | '25' | '50' | '75'): void {
    this.ditherMode = mode;
  }

  private loadSavedPalettes(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(PALETTE_STORAGE_KEY);
      if (raw) this.savedPalettes = JSON.parse(raw) as NamedPalette[];
    } catch {
      this.savedPalettes = [];
    }
  }

  /** Save the current palette to localStorage under a user-supplied name. */
  async saveCurrentPalette(): Promise<void> {
    const name = await this.askPrompt({
      title: 'Save palette',
      value: `Palette ${this.savedPalettes.length + 1}`,
      placeholder: 'Palette name',
      okLabel: 'Save',
    });
    if (!name) return;
    const entry: NamedPalette = {
      id: `saved-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      colors: [...this.palette],
    };
    this.savedPalettes = [
      entry,
      ...this.savedPalettes.filter((p) => p.id !== entry.id),
    ].slice(0, 20);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(this.savedPalettes));
      }
    } catch {
      /* ignore */
    }
  }

  deleteSavedPalette(id: string, event?: Event): void {
    event?.stopPropagation();
    this.savedPalettes = this.savedPalettes.filter((p) => p.id !== id);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(this.savedPalettes));
      }
    } catch {
      /* ignore */
    }
  }

  /** Snap a colour to the nearest palette entry when palette-lock is on. */
  private lockColor(color: string): string {
    if (!this.paletteLock || !this.palette.length) return color;
    const [r, g, b] = this.hexToRgb(color);
    let best = this.palette[0];
    let bestDist = Infinity;
    for (const candidate of this.palette) {
      const [cr, cg, cb] = this.hexToRgb(candidate);
      const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  private hexToRgb(hex: string): [number, number, number] {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    // For #rrggbbaa only the rgb part matters here (alpha handled separately).
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Alpha (0–255) of a colour string; 255 for 6-digit hex. */
  private colorAlpha(hex: string): number {
    const h = hex.replace('#', '');
    return h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  }

  /** Combine an #rrggbb with alpha (0–255) → #rrggbb (a=255) or #rrggbbaa. */
  private withAlpha(hex: string, a: number): string {
    const base = this.rgbToHex(...this.hexToRgb(hex));
    const aa = this.clamp(Math.round(a), 0, 255);
    return aa >= 255 ? base : base + aa.toString(16).padStart(2, '0');
  }

  /** Ordered 4×4 Bayer matrix for pixel-perfect dithering. */
  private static readonly BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];

  /** The colour the brush should place at (x,y), honouring dither + palette-lock. */
  private brushColorAt(x: number, y: number): Pixel {
    const primary = this.lockColor(this.primaryColor);
    if (this.ditherMode === 'off') return primary;
    const count = this.ditherMode === '25' ? 4 : this.ditherMode === '50' ? 8 : 12;
    const threshold = EditorComponent.BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4];
    return threshold < count ? primary : this.lockColor(this.secondaryColor);
  }

  /** Primary colour for fills/shapes, snapped to palette when locked. */
  get effectivePrimary(): string {
    return this.lockColor(this.primaryColor);
  }

  /** Fill the selection (or whole layer) with a primary→secondary gradient. */
  private applyGradient(
    buf: Pixel[],
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): void {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const len = Math.sqrt(lenSq);
    const p = this.hexToRgb(this.lockColor(this.primaryColor));
    const q = this.hexToRgb(this.lockColor(this.secondaryColor));
    const colorAt = (x: number, y: number): string => {
      let t: number;
      if (this.gradientShape === 'radial') {
        t = len < 0.001 ? 0 : Math.hypot(x - ax, y - ay) / len;
      } else {
        t = lenSq < 0.001 ? 0 : ((x - ax) * dx + (y - ay) * dy) / lenSq;
      }
      t = this.clamp(t, 0, 1);
      if (this.gradientDither) {
        const threshold =
          EditorComponent.BAYER4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] / 16;
        return t > threshold
          ? this.lockColor(this.secondaryColor)
          : this.lockColor(this.primaryColor);
      }
      return this.lockColor(
        this.rgbToHex(
          p[0] + (q[0] - p[0]) * t,
          p[1] + (q[1] - p[1]) * t,
          p[2] + (q[2] - p[2]) * t,
        ),
      );
    };
    if (this.selection) {
      this.eachSelectionPixel(this.selection, (x, y) =>
        this.setPixel(buf, x, y, colorAt(x, y)),
      );
    } else {
      for (let y = 0; y < this.height; y += 1) {
        for (let x = 0; x < this.width; x += 1) {
          this.setPixel(buf, x, y, colorAt(x, y));
        }
      }
    }
  }

  /** Palette sorted light→dark for the shading ink. */
  private buildShadeRamp(): string[] {
    return this.dedupeColors([...this.palette]).sort(
      (a, b) => this.colorSortKey(b, 'lum') - this.colorSortKey(a, 'lum'),
    );
  }

  /** Shade: shift each painted pixel one step along the palette ramp. */
  private shadeAt(x: number, y: number): void {
    const ramp = this.shadeRamp;
    if (ramp.length < 2) return;
    const radius = Math.max(1, this.brushSize);
    for (let oy = 0; oy < radius; oy += 1) {
      for (let ox = 0; ox < radius; ox += 1) {
        const px = x + ox;
        const py = y + oy;
        if (!this.inside(px, py)) continue;
        const cur = this.activeLayer.pixels[this.index(px, py)];
        if (!cur) continue;
        // Find the nearest ramp colour, then step toward darker (-1) / lighter (+1).
        let nearest = 0;
        let best = Infinity;
        const [cr, cg, cb] = this.hexToRgb(cur);
        for (let i = 0; i < ramp.length; i += 1) {
          const [rr, rg, rb] = this.hexToRgb(ramp[i]);
          const d = (cr - rr) ** 2 + (cg - rg) ** 2 + (cb - rb) ** 2;
          if (d < best) {
            best = d;
            nearest = i;
          }
        }
        // ramp is light→dark, so darker = larger index.
        const next = this.clamp(
          nearest + (this.shadeDir < 0 ? 1 : -1),
          0,
          ramp.length - 1,
        );
        this.setMirroredPixel(this.activeLayer.pixels, px, py, ramp[next]);
      }
    }
  }

  /** The few palette shades around the primary that a spray dab samples from.
   *  Picked by colour distance (RGB) so spraying a grey stays grey — neighbours
   *  share the primary's hue, not just its brightness. */
  private buildSprayColors(): string[] {
    const pal = this.dedupeColors([...this.palette]);
    const primary = this.lockColor(this.primaryColor);
    if (pal.length >= 3) {
      const [pr, pg, pb] = this.hexToRgb(primary);
      const near = pal
        .map((c) => {
          const [r, g, b] = this.hexToRgb(c);
          return { c, d: (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2 };
        })
        .sort((a, b) => a.d - b.d)
        .slice(0, 5)
        .map((e) => e.c);
      if (near.length >= 3) return near;
    }
    // Palette too small → synthesise a 5-step brightness ramp from the primary.
    const [r, g, b] = this.hexToRgb(primary);
    return [1.28, 1.13, 1, 0.85, 0.7].map((f) =>
      this.rgbToHex(
        this.clamp(Math.round(r * f), 0, 255),
        this.clamp(Math.round(g * f), 0, 255),
        this.clamp(Math.round(b * f), 0, 255),
      ),
    );
  }

  /** Smooth value noise in [0,1] on a coarse grid — gives spray its coherent
   *  clumps (and shade patches) instead of salt-and-pepper single pixels. */
  private sprayNoise(x: number, y: number, seed: number): number {
    const cell = Math.max(2, this.sprayScatter);
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    const fx = x / cell - gx;
    const fy = y / cell - gy;
    const h = (ix: number, iy: number) => {
      const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 53.3) * 43758.5453;
      return n - Math.floor(n);
    };
    const a = h(gx, gy);
    const b = h(gx + 1, gy);
    const c = h(gx, gy + 1);
    const d = h(gx + 1, gy + 1);
    const sx = fx * fx * (3 - 2 * fx); // smoothstep
    const sy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Spray brush: scatter palette-neighbour shades within the radius, clumped by
   *  value noise so it reads as soft mottled water / light / foam — not noise.
   *  Soft edges + coherent shade patches; build up with repeated passes. */
  private sprayAt(x: number, y: number): void {
    if (!this.sprayColors.length) this.sprayColors = this.buildSprayColors();
    const radius = Math.max(2, this.brushSize * 2);
    const r2 = radius * radius;
    const len = this.sprayColors.length;
    for (let oy = -radius; oy <= radius; oy += 1) {
      for (let ox = -radius; ox <= radius; ox += 1) {
        const dist2 = ox * ox + oy * oy;
        if (dist2 > r2) continue;
        const px = x + ox;
        const py = y + oy;
        if (!this.isInSelection(px, py)) continue; // stay inside an active selection
        const falloff = 1 - dist2 / r2; // airbrush-soft edge
        const clump = this.sprayNoise(px, py, 11); // coherent blob shape
        const prob = this.sprayDensity * falloff * (0.3 + clump * 1.1);
        if (Math.random() >= prob) continue;
        // shade from a 2nd noise field → neighbours share a shade (soft loang)
        const idx = Math.min(len - 1, Math.floor(this.sprayNoise(px, py, 29) * len));
        this.setMirroredPixel(this.activeLayer.pixels, px, py, this.sprayColors[idx]);
      }
    }
  }

  setImportPreset(longSide: number): void {
    this.importLongSide = longSide;
  }

  setSecondaryFromPalette(event: MouseEvent, color: string): void {
    event.preventDefault();
    this.secondaryColor = color;
    this.addPaletteColor(color);
  }

  swapColors(): void {
    [this.primaryColor, this.secondaryColor] = [
      this.secondaryColor,
      this.primaryColor,
    ];
  }

  async pickFromScreen(useSecondary = false): Promise<void> {
    if (!window.EyeDropper) {
      return;
    }
    const result = await new window.EyeDropper().open();
    this.applyPickedColor(result.sRGBHex, useSecondary);
  }

  @HostListener('window:keydown', ['$event'])
  handleShortcuts(event: KeyboardEvent): void {
    // Ignore while typing in form fields.
    const target = event.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    // ---- Ctrl/Cmd combos ----
    if (event.ctrlKey || event.metaKey) {
      if (key === 'k') {
        event.preventDefault();
        this.toggleCommandPalette();
      } else if (key === 'j') {
        event.preventDefault();
        this.selectionToNewLayer(event.shiftKey);
      } else if (key === 'z') {
        event.preventDefault();
        event.shiftKey ? this.redo() : this.undo();
      } else if (key === 'y') {
        event.preventDefault();
        this.redo();
      } else if (key === 'c') {
        event.preventDefault();
        this.copySelection();
      } else if (key === 'x') {
        event.preventDefault();
        this.cutSelection();
      } else if (key === 'v') {
        event.preventDefault();
        this.pasteSelection();
      } else if (key === 'l') {
        event.preventDefault();
        this.openAdjust();
      }
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      this.isSpacePanning = true;
      return;
    }

    // ---- Arrow keys = nudge selection/layer ----
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (event.key in nudge) {
      event.preventDefault();
      const [dx, dy] = nudge[event.key];
      this.shift(dx, dy);
      return;
    }

    // ---- Shift combos ----
    if (event.shiftKey) {
      if (key === 'h') {
        this.flipSelection(true);
        return;
      }
      if (key === 'v') {
        this.flipSelection(false);
        return;
      }
      if (key === 'm') {
        this.symmetry = this.symmetry === 'off' ? 'x' : 'off';
        this.render();
        return;
      }
    }

    // ---- Tool selection (P/E/B/I/L/R/O/S/W/Q/M) ----
    const tool = this.tools.find((item) => item.key.toLowerCase() === key);
    if (tool) {
      this.setTool(tool.id);
      return;
    }

    // ---- Plain action keys ----
    switch (key) {
      case 'enter':
        event.preventDefault();
        if (this.tf) this.commitTransform();
        else this.togglePlayback();
        break;
      case ',':
        this.stepFrame(-1);
        break;
      case '.':
        this.stepFrame(1);
        break;
      case 'x':
        this.swapColors();
        break;
      case 'g':
        this.showGrid = !this.showGrid;
        this.render();
        break;
      case '[':
        this.brushSize = this.clamp(this.brushSize - 1, 1, 8);
        break;
      case ']':
        this.brushSize = this.clamp(this.brushSize + 1, 1, 8);
        break;
      case '=':
      case '+':
        this.zoom = this.clamp(this.zoom + 1, this.minZoom, this.maxZoom);
        this.render();
        break;
      case '-':
        this.zoom = this.clamp(this.zoom - 1, this.minZoom, this.maxZoom);
        this.render();
        break;
      case 'delete':
      case 'backspace':
        this.cutSelection();
        break;
    }
  }

  @HostListener('window:keyup', ['$event'])
  handleKeyup(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      this.isSpacePanning = false;
    }
  }

  private captureWorkspace(
    name = this.activeWorkspace?.name ?? 'Workspace',
    id = this.activeWorkspace?.id ?? 1,
  ): WorkspaceState {
    return {
      id,
      name,
      width: this.width,
      height: this.height,
      frames: this.frames.map((frame) => this.cloneFrame(frame, frame.name)),
      tags: (this.tags ?? []).map((t) => ({ ...t })),
      groups: (this.groups ?? []).map((g) => ({ ...g })),
      activeFrameIndex: this.activeFrameIndex,
      activeLayerIndex: this.activeLayerIndex,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      view: this.captureView(),
    };
  }

  /** Snapshot the per-tab view config (zoom, grid, symmetry, …). */
  private captureView(): WorkspaceView {
    const d = this.defaultView();
    return {
      zoom: this.zoom ?? d.zoom,
      displayZoom: this.displayZoom ?? d.displayZoom,
      showGrid: this.showGrid ?? d.showGrid,
      symmetry: this.symmetry ?? d.symmetry,
      pixelPerfect: this.pixelPerfect ?? d.pixelPerfect,
      brushSize: this.brushSize ?? d.brushSize,
      pivotPreset: this.pivotPreset ?? d.pivotPreset,
      sheetColumns: this.sheetColumns ?? d.sheetColumns,
      onionSkin: this.onionSkin ?? d.onionSkin,
      onionTint: this.onionTint ?? d.onionTint,
      onionPrevOpacity: this.onionPrevOpacity ?? d.onionPrevOpacity,
      onionNextOpacity: this.onionNextOpacity ?? d.onionNextOpacity,
    };
  }

  /** Default view for a brand-new tab — independent of the current tab. */
  private defaultView(): WorkspaceView {
    return {
      zoom: 4,
      displayZoom: 6,
      showGrid: true,
      symmetry: 'off',
      pixelPerfect: false,
      brushSize: 1,
      pivotPreset: 'feet',
      sheetColumns: 0,
      onionSkin: false,
      onionTint: true,
      onionPrevOpacity: 0.4,
      onionNextOpacity: 0.25,
    };
  }

  /** Restore a tab's view config. Missing (old files) keeps current values. */
  private applyView(v?: WorkspaceView): void {
    if (!v) return;
    this.zoom = this.clamp(v.zoom ?? 4, this.minZoom, this.maxZoom);
    this.displayZoom = this.clamp(v.displayZoom ?? 6, 2, 12);
    this.showGrid = v.showGrid ?? true;
    this.symmetry = v.symmetry ?? 'off';
    this.pixelPerfect = v.pixelPerfect ?? false;
    this.brushSize = this.clamp(v.brushSize ?? 1, 1, 8);
    this.pivotPreset = v.pivotPreset ?? 'feet';
    this.sheetColumns = this.clamp(v.sheetColumns ?? 0, 0, 32);
    this.onionSkin = v.onionSkin ?? false;
    this.onionTint = v.onionTint ?? true;
    this.onionPrevOpacity = v.onionPrevOpacity ?? 0.4;
    this.onionNextOpacity = v.onionNextOpacity ?? 0.25;
  }

  private saveCurrentWorkspace(): void {
    if (!this.workspaces[this.activeWorkspaceIndex]) {
      return;
    }
    const current = this.workspaces[this.activeWorkspaceIndex];
    this.workspaces[this.activeWorkspaceIndex] = this.captureWorkspace(
      current.name,
      current.id,
    );
  }

  private applyWorkspace(workspace: WorkspaceState): void {
    window.clearTimeout(this.animationTimer);
    this.isPlaying = false;
    this.width = workspace.width;
    this.height = workspace.height;
    this.frames = workspace.frames.map((frame) =>
      this.cloneFrame(frame, frame.name),
    );
    this.tags = (workspace.tags ?? []).map((t) => ({ ...t }));
    this.activeTagId = null;
    this.tagIdSeed = Math.max(1, ...this.tags.map((t) => t.id + 1));
    this.groups = (workspace.groups ?? []).map((g) => ({ ...g }));
    this.groupIdSeed = Math.max(1, ...this.groups.map((g) => g.id + 1));
    this.activeFrameIndex = Math.min(
      workspace.activeFrameIndex,
      this.frames.length - 1,
    );
    this.activeLayerIndex = Math.min(
      workspace.activeLayerIndex,
      this.activeFrame.layers.length - 1,
    );
    this.palette = [...workspace.palette];
    this.primaryColor = workspace.primaryColor;
    this.secondaryColor = workspace.secondaryColor;
    this.selection = null;
    // Keep `clipboard` across workspace switches so copy/paste works tab→tab.
    this.previewPixels = null;
    this.moveStartSelection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.previewFrameIndex = this.activeFrameIndex;
    this.applyView(workspace.view);
    this.refreshAllFrameThumbnails();
    this.render();
  }

  private createBlankWorkspace(name: string, id: number): WorkspaceState {
    return {
      id,
      name,
      width: this.width,
      height: this.height,
      frames: [this.createFrame('Frame 1')],
      tags: [],
      groups: [],
      activeFrameIndex: 0,
      activeLayerIndex: 0,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      view: this.defaultView(),
    };
  }

  private loadProject(project: PixelArtProjectFile): void {
    if (
      project.app !== 'Pixel Studio' ||
      project.version !== 1 ||
      !Array.isArray(project.workspaces) ||
      project.workspaces.length === 0
    ) {
      throw new Error('Unsupported Pixel Studio project file.');
    }
    const workspaces = project.workspaces.map((workspace) =>
      this.normalizeWorkspace(workspace),
    );
    this.workspaces = workspaces;
    this.activeWorkspaceIndex = this.clamp(
      project.activeWorkspaceIndex ?? 0,
      0,
      workspaces.length - 1,
    );
    this.workspaceIdSeed = Math.max(
      project.workspaceIdSeed ?? workspaces.length + 1,
      ...workspaces.map((workspace) => workspace.id + 1),
    );

    const settings = project.settings;
    if (settings) {
      this.zoom = this.clamp(settings.zoom ?? this.zoom, this.minZoom, this.maxZoom);
      this.displayZoom = this.clamp(
        settings.displayZoom ?? this.displayZoom,
        2,
        12,
      );
      this.showGrid = settings.showGrid ?? this.showGrid;
      this.onionSkin = settings.onionSkin ?? this.onionSkin;
      // Migrate legacy mirrorX flag → symmetry mode.
      this.symmetry =
        settings.symmetry ?? (settings.mirrorX ? 'x' : this.symmetry);
      this.pixelPerfect = settings.pixelPerfect ?? this.pixelPerfect;
      this.brushSize = this.clamp(settings.brushSize ?? this.brushSize, 1, 8);
      this.importResizeCanvas =
        settings.importResizeCanvas ?? this.importResizeCanvas;
      this.importLongSide = this.clamp(
        settings.importLongSide ?? this.importLongSide,
        16,
        128,
      );
      this.importFit = settings.importFit ?? this.importFit;
      this.importPaletteSize = this.clamp(
        settings.importPaletteSize ?? this.importPaletteSize,
        4,
        64,
      );
      this.importDither = settings.importDither ?? this.importDither;
      this.importSharpen = this.clamp(
        settings.importSharpen ?? this.importSharpen,
        0,
        1,
      );
      this.importContrast = this.clamp(
        settings.importContrast ?? this.importContrast,
        0.8,
        1.4,
      );
    }

    this.applyWorkspace(this.activeWorkspace);
  }

  private normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
    const width = this.clamp(Math.floor(workspace.width), 8, 128);
    const height = this.clamp(Math.floor(workspace.height), 8, 128);
    const pixelCount = width * height;
    const frames = (
      workspace.frames?.length
        ? workspace.frames
        : [this.createFrame('Frame 1')]
    ).map((frame, frameIndex) => ({
      name: frame.name || `Frame ${frameIndex + 1}`,
      duration: this.clamp(Math.floor(frame.duration ?? 160), 40, 5000),
      visible: frame.visible ?? true,
      layers: (frame.layers?.length
        ? frame.layers
        : [this.createLayer('Layer 1')]
      ).map((layer, layerIndex) => ({
        name: layer.name || `Layer ${layerIndex + 1}`,
        visible: layer.visible ?? true,
        locked: layer.locked ?? false,
        opacity: this.clamp(layer.opacity ?? 1, 0, 1),
        blend: this.normalizeBlend(layer.blend),
        groupId: layer.groupId ?? null,
        pixels: this.normalizePixels(layer.pixels, pixelCount),
      })),
    }));
    const groups = this.normalizeGroups(workspace.groups, frames);
    const activeFrameIndex = this.clamp(
      workspace.activeFrameIndex ?? 0,
      0,
      frames.length - 1,
    );
    const activeLayerIndex = this.clamp(
      workspace.activeLayerIndex ?? 0,
      0,
      frames[activeFrameIndex].layers.length - 1,
    );
    return {
      id: workspace.id || this.workspaceIdSeed++,
      name: workspace.name || 'Imported Workspace',
      width,
      height,
      frames,
      tags: this.normalizeTags(workspace.tags, frames.length),
      groups,
      activeFrameIndex,
      activeLayerIndex,
      palette: this.normalizePalette(workspace.palette),
      primaryColor: this.normalizeRequiredColor(
        workspace.primaryColor,
        '#222831',
      ),
      secondaryColor: this.normalizeRequiredColor(
        workspace.secondaryColor,
        '#f6f1de',
      ),
      view: workspace.view ? { ...workspace.view } : undefined,
    };
  }

  private cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
    return {
      ...workspace,
      frames: workspace.frames.map((frame) =>
        this.cloneFrame(frame, frame.name),
      ),
      tags: (workspace.tags ?? []).map((t) => ({ ...t })),
      groups: (workspace.groups ?? []).map((g) => ({ ...g })),
      palette: [...workspace.palette],
      view: workspace.view ? { ...workspace.view } : undefined,
    };
  }

  private normalizeTags(
    tags: AnimTag[] | undefined,
    frameCount: number,
  ): AnimTag[] {
    if (!Array.isArray(tags) || frameCount <= 0) return [];
    const dirs: TagDirection[] = ['forward', 'reverse', 'pingpong'];
    const max = frameCount - 1;
    return tags.map((t, i) => {
      const from = this.clamp(Math.floor(t?.from ?? 0), 0, max);
      const to = this.clamp(Math.floor(t?.to ?? from), 0, max);
      return {
        id: t?.id || i + 1,
        name: t?.name || `Tag ${i + 1}`,
        from: Math.min(from, to),
        to: Math.max(from, to),
        color: this.normalizeRequiredColor(
          t?.color,
          this.tagColors[i % this.tagColors.length],
        ),
        direction:
          t?.direction && dirs.includes(t.direction) ? t.direction : 'forward',
        repeat: Math.max(0, Math.floor(t?.repeat ?? 0) || 0),
      };
    });
  }

  private normalizeBlend(blend: unknown): BlendMode {
    return this.blendModes.some((b) => b.value === blend)
      ? (blend as BlendMode)
      : 'normal';
  }

  /** Keep only groups actually referenced by a layer; sanitize their fields. */
  private normalizeGroups(
    groups: LayerGroup[] | undefined,
    frames: Frame[],
  ): LayerGroup[] {
    if (!Array.isArray(groups)) return [];
    const used = new Set<number>();
    for (const layer of frames[0]?.layers ?? []) {
      if (layer.groupId != null) used.add(layer.groupId);
    }
    return groups
      .filter((g) => g && used.has(g.id))
      .map((g, i) => ({
        id: g.id,
        name: g.name || `Group ${i + 1}`,
        visible: g.visible ?? true,
        locked: g.locked ?? false,
        collapsed: g.collapsed ?? false,
        opacity: this.clamp(g.opacity ?? 1, 0, 1),
        color: this.normalizeRequiredColor(
          g.color,
          this.groupColors[i % this.groupColors.length],
        ),
      }));
  }

  private normalizePixels(
    pixels: Pixel[] | undefined,
    pixelCount: number,
  ): Pixel[] {
    const normalized = new Array<Pixel>(pixelCount).fill(null);
    for (let i = 0; i < Math.min(pixelCount, pixels?.length ?? 0); i += 1) {
      normalized[i] = this.normalizeColor(pixels![i], null);
    }
    return normalized;
  }

  private normalizePalette(palette: string[] | undefined): string[] {
    const colors = (palette ?? [])
      .map((color) => this.normalizeColor(color, null))
      .filter((color): color is string => Boolean(color));
    return (
      colors.length ? colors : ['#222831', '#393e46', '#00adb5', '#eeeeee']
    ).slice(0, 64);
  }

  private normalizeColor(color: unknown, fallback: string | null): Pixel {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)
      ? color.toLowerCase()
      : fallback;
  }

  private normalizeRequiredColor(color: unknown, fallback: string): string {
    return this.normalizeColor(color, fallback) ?? fallback;
  }

  private createFrame(name: string): Frame {
    return {
      name,
      duration: 160,
      visible: true,
      layers: [this.createLayer('Layer 1')],
    };
  }

  private createLayer(name: string, groupId: number | null = null): Layer {
    return {
      name,
      visible: true,
      locked: false,
      opacity: 1,
      blend: 'normal',
      groupId,
      pixels: new Array<Pixel>(this.width * this.height).fill(null),
    };
  }

  private cloneFrame(frame: Frame, name: string): Frame {
    return {
      name,
      duration: frame.duration,
      visible: frame.visible,
      layers: frame.layers.map((layer) => ({
        ...layer,
        pixels: [...layer.pixels],
      })),
    };
  }

  private eventToPixel(event: PointerEvent): { x: number; y: number } | null {
    const point = this.eventToCanvasPixel(event);
    if (!this.inside(point.x, point.y)) {
      return null;
    }
    return point;
  }

  private eventToCanvasPixel(event: PointerEvent): { x: number; y: number } {
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / this.zoom);
    const y = Math.floor((event.clientY - rect.top) / this.zoom);
    return { x, y };
  }

  private paint(x: number, y: number): void {
    const radius = Math.max(1, this.brushSize);
    const eraser = this.activeTool === 'eraser';
    for (let oy = 0; oy < radius; oy += 1) {
      for (let ox = 0; ox < radius; ox += 1) {
        const px = x + ox;
        const py = y + oy;
        this.setMirroredPixel(
          this.activeLayer.pixels,
          px,
          py,
          eraser ? null : this.brushColorAt(px, py),
        );
      }
    }
  }

  /** Route a freehand stroke cell through pixel-perfect when enabled (size 1). */
  private strokeTo(x: number, y: number): void {
    if (this.customBrush && this.activeTool === 'pen') {
      this.stampBrush(x, y);
      return;
    }
    if (this.pixelPerfect && this.brushSize === 1) {
      this.addPpCell(x, y);
    } else {
      this.paint(x, y);
    }
  }

  // ----- Custom brush / stamp -----

  setBrushFromSelection(): void {
    if (!this.selection) return;
    const sel = this.normalizeSelection(this.selection);
    this.customBrush = { w: sel.w, h: sel.h, pixels: this.selectionPixels(sel) };
  }
  clearBrush(): void {
    this.customBrush = null;
  }
  private stampBrush(x: number, y: number): void {
    const b = this.customBrush;
    if (!b) return;
    const ox = x - Math.floor(b.w / 2);
    const oy = y - Math.floor(b.h / 2);
    for (let by = 0; by < b.h; by += 1) {
      for (let bx = 0; bx < b.w; bx += 1) {
        const c = b.pixels[by * b.w + bx];
        if (c) this.setMirroredPixel(this.activeLayer.pixels, ox + bx, oy + by, c);
      }
    }
  }

  // ----- One-click FX -----

  /** Add a 1px outline (secondary colour) around the active layer's pixels. */
  outlineLayer(): void {
    if (this.activeLayerLocked) return;
    this.pushUndo();
    const src = [...this.activeLayer.pixels];
    const col = this.lockColor(this.secondaryColor);
    const opaque = (x: number, y: number) =>
      this.inside(x, y) && src[this.index(x, y)] != null;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (src[this.index(x, y)] != null) continue;
        if (
          opaque(x - 1, y) ||
          opaque(x + 1, y) ||
          opaque(x, y - 1) ||
          opaque(x, y + 1)
        ) {
          this.setPixel(this.activeLayer.pixels, x, y, col);
        }
      }
    }
    this.render();
  }

  /** Replace every secondary-coloured pixel with the primary colour. */
  replaceColor(): void {
    if (this.activeLayerLocked) return;
    const from = this.secondaryColor.toLowerCase();
    const to = this.lockColor(this.primaryColor);
    this.pushUndo();
    const px = this.activeLayer.pixels;
    for (let i = 0; i < px.length; i += 1) {
      if (px[i] && px[i]!.toLowerCase() === from) px[i] = to;
    }
    this.render();
  }

  /** Begin a fresh pixel-perfect stroke. */
  private resetPixelPerfect(): void {
    this.ppPath = [];
    this.ppOriginal.clear();
  }

  /** Add one cell to a pixel-perfect stroke, dropping redundant L-corners. */
  private addPpCell(x: number, y: number): void {
    const last = this.ppPath[this.ppPath.length - 1];
    if (last && last.x === x && last.y === y) return;
    const color =
      this.activeTool === 'eraser' ? null : this.brushColorAt(x, y);
    this.paintCellSym(x, y, color);
    this.ppPath.push({ x, y });
    const n = this.ppPath.length;
    if (n >= 3) {
      const a = this.ppPath[n - 3];
      const b = this.ppPath[n - 2];
      const c = this.ppPath[n - 1];
      // If a and c are diagonal neighbours, the middle b is a redundant corner.
      if (Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1) {
        this.restoreCellSym(b.x, b.y);
        this.ppPath.splice(n - 2, 1);
      }
    }
  }

  private paintCellSym(x: number, y: number, color: Pixel): void {
    for (const p of this.symmetricPoints(x, y)) {
      const i = this.index(p.x, p.y);
      if (!this.ppOriginal.has(i)) {
        this.ppOriginal.set(i, this.activeLayer.pixels[i] ?? null);
      }
      this.setPixel(this.activeLayer.pixels, p.x, p.y, color);
    }
  }

  private restoreCellSym(x: number, y: number): void {
    for (const p of this.symmetricPoints(x, y)) {
      const i = this.index(p.x, p.y);
      if (this.ppOriginal.has(i)) {
        this.setPixel(this.activeLayer.pixels, p.x, p.y, this.ppOriginal.get(i)!);
      }
    }
  }

  private fillMirrored(x: number, y: number, replacement: Pixel): void {
    // Flood from every symmetry image so fills stay symmetric too.
    for (const p of this.symmetricPoints(x, y)) {
      this.floodFill(
        p.x,
        p.y,
        this.activeLayer.pixels[this.index(p.x, p.y)],
        replacement,
      );
    }
  }

  private floodFill(
    x: number,
    y: number,
    target: Pixel,
    replacement: Pixel,
  ): void {
    if (target === replacement) {
      return;
    }
    const queue = [{ x, y }];
    while (queue.length) {
      const point = queue.shift()!;
      if (
        !this.inside(point.x, point.y) ||
        this.activeLayer.pixels[this.index(point.x, point.y)] !== target
      ) {
        continue;
      }
      this.setPixel(this.activeLayer.pixels, point.x, point.y, replacement);
      queue.push(
        { x: point.x + 1, y: point.y },
        { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 },
        { x: point.x, y: point.y - 1 },
      );
    }
  }

  private drawShape(
    buffer: Pixel[],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    tool: Tool,
  ): void {
    const color = this.effectivePrimary;
    if (tool === 'line') {
      this.drawLine(x0, y0, x1, y1, (x, y) =>
        this.setMirroredPixel(buffer, x, y, color),
      );
    } else if (tool === 'rect') {
      const rect = this.normalizeSelection(this.rectFromPoints(x0, y0, x1, y1));
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        this.setMirroredPixel(buffer, x, rect.y, color);
        this.setMirroredPixel(buffer, x, rect.y + rect.h - 1, color);
      }
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        this.setMirroredPixel(buffer, rect.x, y, color);
        this.setMirroredPixel(buffer, rect.x + rect.w - 1, y, color);
      }
    } else if (tool === 'ellipse') {
      const rect = this.normalizeSelection(this.rectFromPoints(x0, y0, x1, y1));
      const rx = Math.max(1, (rect.w - 1) / 2);
      const ry = Math.max(1, (rect.h - 1) / 2);
      const cx = rect.x + rx;
      const cy = rect.y + ry;
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        for (let x = rect.x; x < rect.x + rect.w; x += 1) {
          const value = Math.pow((x - cx) / rx, 2) + Math.pow((y - cy) / ry, 2);
          if (value > 0.72 && value < 1.28) {
            this.setMirroredPixel(buffer, x, y, color);
          }
        }
      }
    }
  }

  private drawLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    plot: (x: number, y: number) => void,
  ): void {
    let dx = Math.abs(x1 - x0);
    let sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0);
    let sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private applyPickedColor(color: string, useSecondary: boolean): void {
    const picked = this.normalizeHex(color);
    // If the colour already lives in the palette, select that swatch in place
    // (no duplicate, no reorder) so it highlights; otherwise add it.
    const existing = this.palette.find((c) => this.normalizeHex(c) === picked);
    const value = existing ?? picked;
    if (useSecondary) {
      this.secondaryColor = value;
    } else {
      this.primaryColor = value;
      this.pickerAlpha = this.colorAlpha(value);
    }
    if (!existing) this.addPaletteColor(value);
  }

  /** Canonical lowercase 6-digit hex (expands #abc → #aabbcc) for reliable matching. */
  private normalizeHex(color: string): string {
    let h = color.trim().toLowerCase().replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return `#${h}`;
  }

  private shouldPanCanvas(event: PointerEvent): boolean {
    return this.isSpacePanning || event.button === 1;
  }

  private beginPan(event: PointerEvent): void {
    event.preventDefault();
    const wrap = this.canvasWrapRef.nativeElement;
    wrap.setPointerCapture(event.pointerId);
    this.panState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
    };
    this.isPanning = true;
    this.pointer = null;
  }

  render(): void {
    if (!this.ctx) {
      return;
    }
    const canvas = this.stageRef.nativeElement;
    // Only resize the backing store when it actually changes — reallocating a
    // large canvas every pointermove is a major source of lag.
    if (canvas.width !== this.canvasWidth) canvas.width = this.canvasWidth;
    if (canvas.height !== this.canvasHeight) canvas.height = this.canvasHeight;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#f7f7f7';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawCheckerboard();

    if (this.referenceImage && this.referenceVisible && !this.referenceAbove) {
      this.drawReference();
    }

    if (this.onionSkin && !this.isPlaying) {
      // Ghost the neighbouring frames beneath the active one (render-only).
      this.drawOnionFrame(
        this.activeFrameIndex - 1,
        this.onionPrevOpacity,
        this.onionTint ? 'rgba(255, 80, 90, 0.55)' : null,
      );
      this.drawOnionFrame(
        this.activeFrameIndex + 1,
        this.onionNextOpacity,
        this.onionTint ? 'rgba(70, 150, 255, 0.55)' : null,
      );
    }

    this.drawComposite(
      this.ctx,
      this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex,
      this.zoom,
      true,
    );
    if (this.previewPixels) {
      this.drawBlendedPixels(
        this.ctx,
        this.previewPixels,
        this.activeLayer.blend,
        this.zoom,
        this.layerEffectiveOpacity(this.activeLayer),
      );
    }
    if (this.showGrid) {
      this.drawGrid();
    }
    if (this.symmetry !== 'off') {
      this.drawSymmetryGuide();
    }
    if (this.referenceImage && this.referenceVisible && this.referenceAbove) {
      this.drawReference();
    }
    this.drawPivot();
    if (this.selection) {
      this.drawSelection();
    }
    this.drawLasso();
    if (this.tf) this.drawTransformHandles();
    this.renderDisplay();
    this.refreshActiveFrameThumbnail();
    this.drawMinimap();
    this.scheduleAutosave();
  }

  private drawReference(): void {
    const img = this.referenceImage;
    if (!img) return;
    this.ctx.save();
    this.ctx.globalAlpha = this.referenceOpacity;
    this.ctx.imageSmoothingEnabled = !this.referencePixelExact;
    this.ctx.drawImage(img, 0, 0, this.canvasWidth, this.canvasHeight);
    this.ctx.restore();
  }

  loadReference(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // A Pixel Studio export (.pixelart.json) is flattened into a reference image.
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      void this.loadReferenceFromJson(file);
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.setReferenceImage(img, false);
    };
    img.src = URL.createObjectURL(file);
  }

  /** Parse a Pixel Studio export and use its first frame as a flattened reference. */
  private async loadReferenceFromJson(file: File): Promise<void> {
    let project: PixelArtProjectFile;
    try {
      project = JSON.parse(await file.text()) as PixelArtProjectFile;
    } catch {
      return;
    }
    const ws = project?.workspaces?.[0];
    const frame = ws?.frames?.[0];
    if (!ws || !frame) return;
    const dataUrl = this.flattenFrameToDataUrl(ws, frame);
    if (!dataUrl) return;
    const img = new Image();
    img.onload = () => {
      this.setReferenceImage(img, true);
    };
    img.src = dataUrl;
  }

  private setReferenceImage(img: HTMLImageElement, pixelExact: boolean): void {
    this.referenceImage = img;
    this.referencePixelExact = pixelExact;
    this.referenceVisible = true;
    this.render();
  }

  /** Composite a frame's visible layers (skipping hidden groups) into a 1:1 PNG data URL. */
  private flattenFrameToDataUrl(ws: WorkspaceState, frame: Frame): string | null {
    const w = ws.width;
    const h = ws.height;
    if (!w || !h) return null;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const hiddenGroups = new Set(
      (ws.groups ?? []).filter((g) => g.visible === false).map((g) => g.id),
    );
    for (const layer of frame.layers) {
      if (layer.visible === false) continue;
      if (layer.groupId != null && hiddenGroups.has(layer.groupId)) continue;
      const pixels = layer.pixels ?? [];
      for (let i = 0; i < pixels.length; i += 1) {
        const color = pixels[i];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(i % w, Math.floor(i / w), 1, 1);
      }
    }
    return canvas.toDataURL('image/png');
  }

  clearReference(): void {
    this.referenceImage = null;
    this.referencePixelExact = false;
    this.render();
  }

  // ===================== Minimap navigator =====================

  get minimapVisible(): boolean {
    if (!this.minimapOn || !this.canvasWrapRef) return false;
    const wrap = this.canvasWrapRef.nativeElement;
    return (
      this.canvasWidth > wrap.clientWidth + 4 ||
      this.canvasHeight > wrap.clientHeight + 4
    );
  }

  /** Re-draw the minimap when the canvas is scrolled. */
  onCanvasScroll(): void {
    this.drawMinimap();
  }

  private drawMinimap(): void {
    if (!this.isBrowser || !this.minimapVisible) return;
    const cv = this.minimapRef?.nativeElement;
    const ctx = this.minimapCtx;
    if (!cv || !ctx || !this.canvasWrapRef) return;
    const wrap = this.canvasWrapRef.nativeElement;
    const MAX = 120;
    const mscale = Math.min(MAX / this.width, MAX / this.height);
    const mw = Math.max(1, Math.round(this.width * mscale));
    const mh = Math.max(1, Math.round(this.height * mscale));
    if (cv.width !== mw) cv.width = mw;
    if (cv.height !== mh) cv.height = mh;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0c0f14';
    ctx.fillRect(0, 0, mw, mh);
    ctx.drawImage(
      this.renderFrameCanvas(this.activePreviewFrameIndex, 1),
      0,
      0,
      this.width,
      this.height,
      0,
      0,
      mw,
      mh,
    );
    // Visible-region rectangle.
    const sx = wrap.scrollLeft / this.canvasWidth;
    const sy = wrap.scrollTop / this.canvasHeight;
    const vw = Math.min(1, wrap.clientWidth / this.canvasWidth);
    const vh = Math.min(1, wrap.clientHeight / this.canvasHeight);
    ctx.strokeStyle = '#34e0c6';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(sx * mw) + 0.5,
      Math.round(sy * mh) + 0.5,
      Math.max(2, Math.round(vw * mw)),
      Math.max(2, Math.round(vh * mh)),
    );
  }

  onMinimapDown(event: PointerEvent): void {
    event.preventDefault();
    this.minimapDragging = true;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    this.minimapPanTo(event);
  }
  onMinimapMove(event: PointerEvent): void {
    if (this.minimapDragging) this.minimapPanTo(event);
  }
  onMinimapUp(event: PointerEvent): void {
    this.minimapDragging = false;
    try {
      (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  }
  private minimapPanTo(event: PointerEvent): void {
    const cv = this.minimapRef?.nativeElement;
    if (!cv || !this.canvasWrapRef) return;
    const r = cv.getBoundingClientRect();
    const fx = this.clamp((event.clientX - r.left) / r.width, 0, 1);
    const fy = this.clamp((event.clientY - r.top) / r.height, 0, 1);
    const wrap = this.canvasWrapRef.nativeElement;
    wrap.scrollLeft = fx * this.canvasWidth - wrap.clientWidth / 2;
    wrap.scrollTop = fy * this.canvasHeight - wrap.clientHeight / 2;
    this.drawMinimap();
  }

  private renderDisplay(): void {
    if (!this.displayCtx || !this.displayRef) {
      return;
    }
    const canvas = this.displayRef.nativeElement;
    if (canvas.width !== this.displayCanvasWidth) {
      canvas.width = this.displayCanvasWidth;
    }
    if (canvas.height !== this.displayCanvasHeight) {
      canvas.height = this.displayCanvasHeight;
    }
    this.displayCtx.imageSmoothingEnabled = false;
    this.displayCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (this.tiledPreview) {
      // Seamless 3×3 repeat so edges can be checked for tiling artefacts.
      const tscale = Math.max(1, Math.floor(this.displayZoom / 3));
      const tile = this.renderFrameCanvas(
        this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex,
        tscale,
      );
      const tw = tile.width;
      const th = tile.height;
      const offX = Math.floor((canvas.width - tw * 3) / 2);
      const offY = Math.floor((canvas.height - th * 3) / 2);
      this.drawCheckerboardTo(this.displayCtx, this.displayZoom);
      for (let j = 0; j < 3; j += 1) {
        for (let i = 0; i < 3; i += 1) {
          this.displayCtx.drawImage(tile, offX + i * tw, offY + j * th);
        }
      }
      return;
    }

    this.drawCheckerboardTo(this.displayCtx, this.displayZoom);
    this.drawComposite(
      this.displayCtx,
      this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex,
      this.displayZoom,
      true,
    );
    if (this.previewPixels) {
      this.drawBlendedPixels(
        this.displayCtx,
        this.previewPixels,
        this.activeLayer.blend,
        this.displayZoom,
        this.layerEffectiveOpacity(this.activeLayer),
      );
    }
  }

  private refreshActiveFrameThumbnail(): void {
    this.refreshFrameThumbnail(this.activePreviewFrameIndex);
  }

  private refreshAllFrameThumbnails(): void {
    this.frameThumbnails = new Array(this.frames.length).fill('');
    for (let i = 0; i < this.frames.length; i += 1) {
      this.refreshFrameThumbnail(i);
    }
  }

  private refreshFrameThumbnail(frameIndex: number): void {
    const frame = this.frames[frameIndex];
    if (!frame) {
      return;
    }
    const previewWidth = 52;
    const previewHeight = 52;
    const canvas = document.createElement('canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.imageSmoothingEnabled = false;
    this.drawCheckerboardTo(
      ctx,
      Math.max(4, Math.floor(previewWidth / Math.max(this.width, this.height))),
    );
    const scale = Math.max(
      1,
      Math.floor(
        Math.min(previewWidth / this.width, previewHeight / this.height),
      ),
    );
    const drawWidth = this.width * scale;
    const drawHeight = this.height * scale;
    const offsetX = Math.floor((previewWidth - drawWidth) / 2);
    const offsetY = Math.floor((previewHeight - drawHeight) / 2);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    frame.layers.forEach((layer) => {
      if (this.layerEffectivelyVisible(layer)) {
        this.drawBlendedPixels(
          ctx,
          layer.pixels,
          layer.blend,
          scale,
          this.layerEffectiveOpacity(layer),
        );
      }
    });
    ctx.restore();
    this.frameThumbnails[frameIndex] = canvas.toDataURL('image/png');
  }

  frameThumbnail(frameIndex: number): string {
    return this.frameThumbnails[frameIndex] || '';
  }

  frameDurationLabel(frameIndex: number): string {
    return `${this.frames[frameIndex]?.duration ?? 0} ms`;
  }

  /** Draw a neighbouring frame as a translucent (optionally tinted) onion overlay. */
  private drawOnionFrame(frameIndex: number, alpha: number, tint: string | null): void {
    const frame = this.frames[frameIndex];
    if (!frame || !frame.visible || alpha <= 0) {
      return;
    }
    const off = document.createElement('canvas');
    off.width = this.canvasWidth;
    off.height = this.canvasHeight;
    const octx = off.getContext('2d');
    if (!octx) {
      return;
    }
    octx.imageSmoothingEnabled = false;
    this.drawComposite(octx, frameIndex, this.zoom, false);
    if (tint) {
      // Tint only the drawn pixels so prev (red) / next (blue) are distinguishable.
      octx.globalCompositeOperation = 'source-atop';
      octx.fillStyle = tint;
      octx.fillRect(0, 0, off.width, off.height);
      octx.globalCompositeOperation = 'source-over';
    }
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(off, 0, 0);
    this.ctx.globalAlpha = 1;
  }

  private drawComposite(
    ctx: CanvasRenderingContext2D,
    frameIndex: number,
    scale: number,
    skipActivePreview: boolean,
  ): void {
    const frame = this.frames[frameIndex];
    if (!frame || !frame.visible) {
      return;
    }
    frame.layers.forEach((layer, index) => {
      if (
        !this.layerEffectivelyVisible(layer) ||
        (skipActivePreview &&
          this.previewPixels &&
          index === this.activeLayerIndex)
      ) {
        return;
      }
      this.drawBlendedPixels(
        ctx,
        layer.pixels,
        layer.blend,
        scale,
        this.layerEffectiveOpacity(layer),
      );
    });
  }

  /**
   * Draw a pixel buffer with a blend mode. For non-normal blends we render the
   * layer to a scratch canvas once and composite it with a single drawImage,
   * instead of blending thousands of fillRects against the backdrop (slow).
   */
  private drawBlendedPixels(
    ctx: CanvasRenderingContext2D,
    pixels: Pixel[],
    blend: BlendMode | undefined,
    scale: number,
    opacity: number,
  ): void {
    const op = this.compositeOp(blend);
    if (op === 'source-over') {
      this.drawPixels(ctx, pixels, scale, opacity);
      return;
    }
    const w = this.width * scale;
    const h = this.height * scale;
    const scratch = this.getBlendScratch(w, h);
    if (!scratch) {
      // Fallback: blend directly if no scratch context is available.
      ctx.globalCompositeOperation = op;
      this.drawPixels(ctx, pixels, scale, opacity);
      ctx.globalCompositeOperation = 'source-over';
      return;
    }
    scratch.ctx.clearRect(0, 0, scratch.canvas.width, scratch.canvas.height);
    this.drawPixels(scratch.ctx, pixels, scale, 1);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = opacity;
    ctx.drawImage(scratch.canvas, 0, 0, w, h, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A lazily-sized offscreen canvas reused for blend compositing. */
  private getBlendScratch(
    w: number,
    h: number,
  ): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (!this.isBrowser) return null;
    if (!this.blendScratch) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      this.blendScratch = { canvas, ctx };
    }
    const { canvas, ctx } = this.blendScratch;
    if (canvas.width < w || canvas.height < h) {
      canvas.width = Math.max(canvas.width, w);
      canvas.height = Math.max(canvas.height, h);
    }
    ctx.imageSmoothingEnabled = false;
    return this.blendScratch;
  }

  /** Map a layer blend mode to a canvas composite operation. */
  private compositeOp(blend: BlendMode | undefined): GlobalCompositeOperation {
    switch (blend) {
      case 'multiply':
        return 'multiply';
      case 'screen':
        return 'screen';
      case 'overlay':
        return 'overlay';
      case 'darken':
        return 'darken';
      case 'lighten':
        return 'lighten';
      case 'add':
        return 'lighter';
      case 'difference':
        return 'difference';
      default:
        return 'source-over';
    }
  }

  private groupById(id: number | null | undefined): LayerGroup | undefined {
    return id == null ? undefined : this.groups.find((g) => g.id === id);
  }

  /** A layer is drawn only if it and its group (if any) are both visible. */
  private layerEffectivelyVisible(layer: Layer): boolean {
    if (!layer.visible) return false;
    const g = this.groupById(layer.groupId);
    return !g || g.visible;
  }

  /** Effective opacity folds in the owning group's opacity. */
  private layerEffectiveOpacity(layer: Layer): number {
    const g = this.groupById(layer.groupId);
    return layer.opacity * (g ? g.opacity : 1);
  }

  /**
   * Draw a pixel buffer by writing it to a 1× offscreen via ImageData and
   * scaling with a single drawImage — far cheaper than per-pixel fillRect,
   * especially at high zoom / large canvases.
   */
  private drawPixels(
    ctx: CanvasRenderingContext2D,
    pixels: Pixel[],
    scale: number,
    opacity: number,
  ): void {
    const W = this.width;
    const H = this.height;
    const sc = this.getPixelScratch(W, H);
    const d = sc.img.data;
    d.fill(0);
    for (let i = 0; i < pixels.length; i += 1) {
      const color = pixels[i];
      if (!color) continue;
      const c = this.hexInt(color);
      const o = i * 4;
      if (color.length > 7) {
        // #rrggbbaa — per-pixel alpha
        d[o] = (c >>> 24) & 255;
        d[o + 1] = (c >>> 16) & 255;
        d[o + 2] = (c >>> 8) & 255;
        d[o + 3] = c & 255;
      } else {
        d[o] = (c >> 16) & 255;
        d[o + 1] = (c >> 8) & 255;
        d[o + 2] = c & 255;
        d[o + 3] = 255;
      }
    }
    sc.ctx.putImageData(sc.img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = opacity;
    ctx.drawImage(sc.canvas, 0, 0, W, H, 0, 0, W * scale, H * scale);
    ctx.restore();
  }

  private pixelScratch?: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    img: ImageData;
    w: number;
    h: number;
  };
  private getPixelScratch(w: number, h: number) {
    if (
      !this.pixelScratch ||
      this.pixelScratch.w !== w ||
      this.pixelScratch.h !== h
    ) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      this.pixelScratch = { canvas, ctx, img: ctx.createImageData(w, h), w, h };
    }
    return this.pixelScratch;
  }

  private readonly hexCache = new Map<string, number>();
  private hexInt(hex: string): number {
    let v = this.hexCache.get(hex);
    if (v === undefined) {
      v = parseInt(hex.slice(1), 16) || 0;
      this.hexCache.set(hex, v);
    }
    return v;
  }

  private drawCheckerboard(): void {
    this.drawCheckerboardTo(this.ctx, this.zoom);
  }

  /** Fill the canvas with a checkerboard using a repeating pattern (1 fill). */
  private drawCheckerboardTo(
    ctx: CanvasRenderingContext2D,
    cell: number,
  ): void {
    const tile = document.createElement('canvas');
    tile.width = cell * 2;
    tile.height = cell * 2;
    const tc = tile.getContext('2d');
    if (!tc) return;
    tc.fillStyle = '#ffffff';
    tc.fillRect(0, 0, cell * 2, cell * 2);
    tc.fillStyle = '#e8ecef';
    tc.fillRect(cell, 0, cell, cell);
    tc.fillRect(0, cell, cell, cell);
    const pattern = ctx.createPattern(tile, 'repeat');
    if (!pattern) return;
    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, this.width * cell, this.height * cell);
    ctx.restore();
  }

  private drawGrid(): void {
    // Skip the pixel grid when zoomed far out — lines would just be noise.
    if (this.zoom < 4) {
      return;
    }
    this.ctx.strokeStyle = 'rgba(20, 25, 32, 0.16)';
    this.ctx.lineWidth = 1;
    for (let x = 0; x <= this.width; x += 1) {
      this.ctx.beginPath();
      this.ctx.moveTo(x * this.zoom + 0.5, 0);
      this.ctx.lineTo(x * this.zoom + 0.5, this.canvasHeight);
      this.ctx.stroke();
    }
    for (let y = 0; y <= this.height; y += 1) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y * this.zoom + 0.5);
      this.ctx.lineTo(this.canvasWidth, y * this.zoom + 0.5);
      this.ctx.stroke();
    }
  }

  /** Draw the pivot/anchor crosshair (display only, not part of the sprite). */
  private drawPivot(): void {
    const p = this.pivotPoint;
    const cx = p.x * this.zoom;
    const cy = p.y * this.zoom;
    const r = 5;
    this.ctx.save();
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeStyle = 'rgba(255, 60, 160, 0.95)';
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    this.ctx.moveTo(cx - r - 3, cy);
    this.ctx.lineTo(cx + r + 3, cy);
    this.ctx.moveTo(cx, cy - r - 3);
    this.ctx.lineTo(cx, cy + r + 3);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSymmetryGuide(): void {
    const cx = this.canvasWidth / 2;
    const cy = this.canvasHeight / 2;
    const dash: [number, number] = [
      Math.max(4, Math.floor(this.zoom * 0.45)),
      Math.max(3, Math.floor(this.zoom * 0.3)),
    ];
    const vertical = this.symmetry !== 'y';
    const horizontal =
      this.symmetry === 'y' ||
      this.symmetry === 'both' ||
      this.symmetry === 'mandala';
    const diagonal = this.symmetry === 'mandala' && this.width === this.height;

    const line = (x0: number, y0: number, x1: number, y1: number) => {
      this.ctx.lineWidth = 3;
      this.ctx.setLineDash([]);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      this.ctx.beginPath();
      this.ctx.moveTo(x0, y0);
      this.ctx.lineTo(x1, y1);
      this.ctx.stroke();
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash(dash);
      this.ctx.strokeStyle = '#e85d75';
      this.ctx.beginPath();
      this.ctx.moveTo(x0, y0);
      this.ctx.lineTo(x1, y1);
      this.ctx.stroke();
    };

    this.ctx.save();
    if (vertical) line(cx, 0, cx, this.canvasHeight);
    if (horizontal) line(0, cy, this.canvasWidth, cy);
    if (diagonal) {
      line(0, 0, this.canvasWidth, this.canvasHeight);
      line(this.canvasWidth, 0, 0, this.canvasHeight);
    }
    this.ctx.restore();
  }

  private drawSelection(): void {
    if (!this.selection) {
      return;
    }
    const sel = this.selection;
    const z = this.zoom;
    // For non-rectangular (wand/lasso) selections, tint the selected cells so
    // the actual shape is visible, then outline the bounding box.
    if (sel.mask) {
      this.ctx.fillStyle = 'rgba(52, 224, 198, 0.22)';
      for (let ry = 0; ry < sel.h; ry += 1) {
        for (let rx = 0; rx < sel.w; rx += 1) {
          if (sel.mask[ry * sel.w + rx]) {
            this.ctx.fillRect((sel.x + rx) * z, (sel.y + ry) * z, z, z);
          }
        }
      }
    }
    this.ctx.strokeStyle = '#111827';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 4]);
    this.ctx.strokeRect(
      sel.x * z + 1,
      sel.y * z + 1,
      sel.w * z - 2,
      sel.h * z - 2,
    );
    this.ctx.setLineDash([]);
  }

  /** Draw the free-transform bounding box, scale handles and rotate knob. */
  private drawTransformHandles(): void {
    if (!this.tf) return;
    const z = this.zoom;
    const hw = this.tf.w / 2;
    const hh = this.tf.h / 2;
    const scr = (a: number, b: number) => {
      const c = this.transformLocalToCanvas(a, b);
      return { x: c.x * z, y: c.y * z };
    };
    const c1 = scr(-hw, -hh);
    const c2 = scr(hw, -hh);
    const c3 = scr(hw, hh);
    const c4 = scr(-hw, hh);
    this.ctx.save();
    this.ctx.lineWidth = 1.5;
    this.ctx.strokeStyle = '#34e0c6';
    this.ctx.setLineDash([4, 3]);
    this.ctx.beginPath();
    this.ctx.moveTo(c1.x, c1.y);
    this.ctx.lineTo(c2.x, c2.y);
    this.ctx.lineTo(c3.x, c3.y);
    this.ctx.lineTo(c4.x, c4.y);
    this.ctx.closePath();
    this.ctx.stroke();
    const top = scr(0, -hh);
    const knob = scr(0, -hh - 14 / z);
    this.ctx.beginPath();
    this.ctx.moveTo(top.x, top.y);
    this.ctx.lineTo(knob.x, knob.y);
    this.ctx.stroke();
    this.ctx.setLineDash([]);
    for (const h of this.transformHandleLocals()) {
      const s = scr(h.a, h.b);
      this.ctx.strokeStyle = '#0b0e12';
      this.ctx.lineWidth = 1;
      if (h.id === 'rotate') {
        this.ctx.fillStyle = '#ffd166';
        this.ctx.beginPath();
        this.ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
      } else {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
        this.ctx.strokeRect(s.x - 3, s.y - 3, 6, 6);
      }
    }
    this.ctx.restore();
  }

  /** Draw the in-progress lasso path while dragging. */
  private drawLasso(): void {
    if (this.activeTool !== 'lasso' || this.lassoPoints.length < 2) {
      return;
    }
    const z = this.zoom;
    this.ctx.strokeStyle = '#34e0c6';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([4, 3]);
    this.ctx.beginPath();
    this.lassoPoints.forEach((p, i) => {
      const cx = p.x * z + z / 2;
      const cy = p.y * z + z / 2;
      if (i === 0) this.ctx.moveTo(cx, cy);
      else this.ctx.lineTo(cx, cy);
    });
    this.ctx.closePath();
    this.ctx.stroke();
    this.ctx.setLineDash([]);
  }

  private resizeCanvasForImage(image: HTMLImageElement): void {
    const longSide = this.clamp(Math.floor(this.importLongSide), 16, 128);
    const aspect = image.width / image.height;
    if (image.width >= image.height) {
      this.width = longSide;
      this.height = this.clamp(Math.round(longSide / aspect), 8, 128);
    } else {
      this.height = longSide;
      this.width = this.clamp(Math.round(longSide * aspect), 8, 128);
    }
  }

  private sampleImage(
    image: HTMLImageElement,
    width: number,
    height: number,
    options: SampleOptions = {},
  ): { pixels: Pixel[]; palette: string[] } {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    const source = options.sourceRect ?? {
      x: 0,
      y: 0,
      w: image.width,
      h: image.height,
    };
    const target = this.getImportTargetRect(source.w, source.h, width, height);
    ctx.drawImage(
      image,
      source.x,
      source.y,
      source.w,
      source.h,
      target.x,
      target.y,
      target.w,
      target.h,
    );
    const imageData = ctx.getImageData(0, 0, width, height);
    if (options.transparentWhite) {
      this.removeWhiteBackground(imageData);
    }
    this.enhanceImageData(imageData, width, height);
    return this.imageDataToPixels(imageData, width, height);
  }

  private imageDataToPixels(
    imageData: ImageData,
    width: number,
    height: number,
  ): { pixels: Pixel[]; palette: string[] } {
    const data = new Float32Array(imageData.data.length);
    for (let i = 0; i < imageData.data.length; i += 1) {
      data[i] = imageData.data[i];
    }
    const palette = this.buildPalette(imageData.data, this.importPaletteSize);
    const counts = new Map<string, number>();
    const pixels: Pixel[] = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 20 || palette.length === 0) {
          pixels.push(null);
          continue;
        }
        const nearest = this.nearestPaletteColor(
          data[i],
          data[i + 1],
          data[i + 2],
          palette,
        );
        const color = this.rgbToHex(nearest[0], nearest[1], nearest[2]);
        pixels.push(color);
        counts.set(color, (counts.get(color) ?? 0) + 1);
        if (this.importDither) {
          this.spreadDitherError(data, width, height, x, y, [
            data[i] - nearest[0],
            data[i + 1] - nearest[1],
            data[i + 2] - nearest[2],
          ]);
        }
      }
    }
    return {
      pixels,
      palette: [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 32)
        .map(([color]) => color),
    };
  }

  private getImportTargetRect(
    sourceWidth: number,
    sourceHeight: number,
    width: number,
    height: number,
  ): { x: number; y: number; w: number; h: number } {
    if (this.importFit === 'stretch') {
      return { x: 0, y: 0, w: width, h: height };
    }
    const scale =
      this.importFit === 'cover'
        ? Math.max(width / sourceWidth, height / sourceHeight)
        : Math.min(width / sourceWidth, height / sourceHeight);
    const w = sourceWidth * scale;
    const h = sourceHeight * scale;
    return {
      x: (width - w) / 2,
      y: (height - h) / 2,
      w,
      h,
    };
  }

  private removeWhiteBackground(imageData: ImageData): void {
    const width = imageData.width;
    const height = imageData.height;
    const visited = new Uint8Array(width * height);
    const queue: { x: number; y: number }[] = [];
    for (let x = 0; x < width; x += 1) {
      queue.push({ x, y: 0 }, { x, y: height - 1 });
    }
    for (let y = 1; y < height - 1; y += 1) {
      queue.push({ x: 0, y }, { x: width - 1, y });
    }
    while (queue.length) {
      const point = queue.shift()!;
      if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
        continue;
      }
      const pixelIndex = point.y * width + point.x;
      if (visited[pixelIndex]) {
        continue;
      }
      visited[pixelIndex] = 1;
      const dataIndex = pixelIndex * 4;
      const r = imageData.data[dataIndex];
      const g = imageData.data[dataIndex + 1];
      const b = imageData.data[dataIndex + 2];
      const isBackdrop =
        imageData.data[dataIndex + 3] < 20 ||
        (r > 238 &&
          g > 238 &&
          b > 238 &&
          Math.max(r, g, b) - Math.min(r, g, b) < 16);
      if (!isBackdrop) {
        continue;
      }
      imageData.data[dataIndex + 3] = 0;
      queue.push(
        { x: point.x + 1, y: point.y },
        { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 },
        { x: point.x, y: point.y - 1 },
      );
    }
  }

  private enhanceImageData(
    imageData: ImageData,
    width: number,
    height: number,
  ): void {
    const source = new Uint8ClampedArray(imageData.data);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (source[i + 3] < 20) {
          continue;
        }
        for (let channel = 0; channel < 3; channel += 1) {
          let sum = 0;
          let count = 0;
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              const nx = this.clamp(x + ox, 0, width - 1);
              const ny = this.clamp(y + oy, 0, height - 1);
              sum += source[(ny * width + nx) * 4 + channel];
              count += 1;
            }
          }
          const sharpened =
            source[i + channel] +
            this.importSharpen * (source[i + channel] - sum / count);
          imageData.data[i + channel] = this.clamp(
            Math.round((sharpened - 128) * this.importContrast + 128),
            0,
            255,
          );
        }
      }
    }
  }

  private buildPalette(data: Uint8ClampedArray, size: number): number[][] {
    const buckets = new Map<string, { rgb: number[]; count: number }>();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 20) {
        continue;
      }
      const r = Math.round(data[i] / 8) * 8;
      const g = Math.round(data[i + 1] / 8) * 8;
      const b = Math.round(data[i + 2] / 8) * 8;
      const key = `${r},${g},${b}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count += 1;
      } else {
        buckets.set(key, { rgb: [r, g, b], count: 1 });
      }
    }
    let colors = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(size * 8, size))
      .map((item) => ({ rgb: item.rgb, cluster: 0 }));
    if (colors.length <= size) {
      return colors.map((item) => item.rgb);
    }
    let centers = colors
      .filter(
        (_, index) =>
          index % Math.max(1, Math.floor(colors.length / size)) === 0,
      )
      .slice(0, size)
      .map((item) => [...item.rgb]);
    for (let iteration = 0; iteration < 8; iteration += 1) {
      colors = colors.map((color) => ({
        ...color,
        cluster: this.nearestPaletteIndex(
          color.rgb[0],
          color.rgb[1],
          color.rgb[2],
          centers,
        ),
      }));
      centers = centers.map((center, index) => {
        const group = colors.filter((color) => color.cluster === index);
        if (!group.length) {
          return center;
        }
        return [0, 1, 2].map((channel) =>
          Math.round(
            group.reduce((sum, color) => sum + color.rgb[channel], 0) /
              group.length,
          ),
        );
      });
    }
    return centers;
  }

  private nearestPaletteColor(
    r: number,
    g: number,
    b: number,
    palette: number[][],
  ): number[] {
    return palette[this.nearestPaletteIndex(r, g, b, palette)];
  }

  private nearestPaletteIndex(
    r: number,
    g: number,
    b: number,
    palette: number[][],
  ): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    palette.forEach((color, index) => {
      const dr = r - color[0];
      const dg = g - color[1];
      const db = b - color[2];
      const distance = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    return best;
  }

  private spreadDitherError(
    data: Float32Array,
    width: number,
    height: number,
    x: number,
    y: number,
    error: number[],
  ): void {
    const targets = [
      { x: x + 1, y, factor: 7 / 16 },
      { x: x - 1, y: y + 1, factor: 3 / 16 },
      { x, y: y + 1, factor: 5 / 16 },
      { x: x + 1, y: y + 1, factor: 1 / 16 },
    ];
    for (const target of targets) {
      if (
        target.x < 0 ||
        target.y < 0 ||
        target.x >= width ||
        target.y >= height
      ) {
        continue;
      }
      const i = (target.y * width + target.x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[i + channel] = this.clamp(
          data[i + channel] + error[channel] * target.factor,
          0,
          255,
        );
      }
    }
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map((value) => this.clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }

  private loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(image.src);
        resolve(image);
      };
      image.onerror = reject;
      image.src = URL.createObjectURL(file);
    });
  }

  private loadImageUrl(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  private moveSelectionPreview(dx: number, dy: number): void {
    if (!this.selection || !this.previewPixels || !this.moveStartSelection) {
      return;
    }
    const moved = {
      ...this.moveStartSelection,
      x: this.moveStartSelection.x + dx,
      y: this.moveStartSelection.y + dy,
      pixels: [...this.moveStartSelection.pixels],
    };
    this.previewPixels = [...this.activeLayer.pixels];
    this.eachSelectionPixel(this.moveStartSelection, (x, y) =>
      this.setPixel(this.previewPixels!, x, y, null),
    );
    this.selection = moved;
    this.stampSelection(moved, this.previewPixels);
  }

  private stampSelection(
    selection: Selection,
    buffer = this.activeLayer.pixels,
  ): void {
    for (let y = 0; y < selection.h; y += 1) {
      for (let x = 0; x < selection.w; x += 1) {
        const i = y * selection.w + x;
        if (selection.mask && !selection.mask[i]) continue;
        const color = selection.pixels[i];
        // Only deposit actual pixels — never punch transparent holes into art below.
        if (color == null) continue;
        this.setPixel(buffer, selection.x + x, selection.y + y, color);
      }
    }
  }

  private copyPixels(selection: Selection): Pixel[] {
    const pixels: Pixel[] = [];
    for (let y = 0; y < selection.h; y += 1) {
      for (let x = 0; x < selection.w; x += 1) {
        const i = y * selection.w + x;
        const sourceX = selection.x + x;
        const sourceY = selection.y + y;
        const masked = selection.mask ? selection.mask[i] : true;
        pixels.push(
          masked && this.inside(sourceX, sourceY)
            ? (this.activeLayer.pixels[this.index(sourceX, sourceY)] ?? null)
            : null,
        );
      }
    }
    return pixels;
  }

  private selectionPixels(selection: Selection): Pixel[] {
    return selection.pixels.length === selection.w * selection.h
      ? [...selection.pixels]
      : this.copyPixels(selection);
  }

  /** True if (x,y) is inside the active selection (or always, when none). */
  private isInSelection(x: number, y: number): boolean {
    const s = this.selection;
    if (!s) return true;
    const rx = x - s.x;
    const ry = y - s.y;
    if (rx < 0 || ry < 0 || rx >= s.w || ry >= s.h) return false;
    return !s.mask || !!s.mask[ry * s.w + rx];
  }

  private eachSelectionPixel(
    selection: Selection,
    fn: (x: number, y: number) => void,
  ): void {
    for (let ry = 0; ry < selection.h; ry += 1) {
      for (let rx = 0; rx < selection.w; rx += 1) {
        if (selection.mask && !selection.mask[ry * selection.w + rx]) continue;
        fn(selection.x + rx, selection.y + ry);
      }
    }
  }

  private rectFromPoints(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Selection {
    return this.normalizeSelection({
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0) + 1,
      h: Math.abs(y1 - y0) + 1,
      pixels: [],
    });
  }

  private normalizeSelection(selection: Selection): Selection {
    const x = this.clamp(selection.x, 0, this.width - 1);
    const y = this.clamp(selection.y, 0, this.height - 1);
    return {
      ...selection,
      x,
      y,
      w: this.clamp(selection.w, 1, this.width - x),
      h: this.clamp(selection.h, 1, this.height - y),
    };
  }

  // ===================== Magic wand & lasso =====================

  /** Magic wand: select the contiguous same-color region on the active layer. */
  private selectByWand(
    sx: number,
    sy: number,
    add: boolean,
    subtract: boolean,
  ): void {
    const region = this.floodRegion(sx, sy);
    let mask = region;
    if ((add || subtract) && this.selection) {
      mask = this.combineMask(
        this.selectionToCanvasMask(this.selection),
        region,
        subtract ? 'subtract' : 'add',
      );
    }
    this.selection = this.canvasMaskToSelection(mask);
    this.moveStartSelection = null;
    this.previewPixels = null;
  }

  private finishLasso(): void {
    const pts = this.lassoPoints;
    this.lassoPoints = [];
    if (pts.length < 3) {
      // A click (not a drag) clears the selection.
      this.selection = null;
      this.render();
      return;
    }
    const region = this.rasterizePolygon(pts);
    let mask = region;
    if (this.lassoMode !== 'replace' && this.selection) {
      mask = this.combineMask(
        this.selectionToCanvasMask(this.selection),
        region,
        this.lassoMode === 'subtract' ? 'subtract' : 'add',
      );
    }
    this.selection = this.canvasMaskToSelection(mask);
    this.moveStartSelection = null;
    this.previewPixels = null;
    this.render();
  }

  /** Contiguous flood of equal-color cells on the active layer (4-neighbour). */
  private floodRegion(sx: number, sy: number): boolean[] {
    const W = this.width;
    const H = this.height;
    const mask = new Array<boolean>(W * H).fill(false);
    if (!this.inside(sx, sy)) return mask;
    const px = this.activeLayer.pixels;
    const target = px[this.index(sx, sy)] ?? null;
    const stack: [number, number][] = [[sx, sy]];
    while (stack.length) {
      const [x, y] = stack.pop()!;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = this.index(x, y);
      if (mask[i]) continue;
      if ((px[i] ?? null) !== target) continue;
      mask[i] = true;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return mask;
  }

  /** Rasterize a polygon to a full-canvas mask (even-odd, sampling pixel centers). */
  private rasterizePolygon(pts: { x: number; y: number }[]): boolean[] {
    const W = this.width;
    const H = this.height;
    const mask = new Array<boolean>(W * H).fill(false);
    let minX = W;
    let minY = H;
    let maxX = 0;
    let maxY = 0;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    minX = this.clamp(minX, 0, W - 1);
    maxX = this.clamp(maxX, 0, W - 1);
    minY = this.clamp(minY, 0, H - 1);
    maxY = this.clamp(maxY, 0, H - 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (this.pointInPolygon(x + 0.5, y + 0.5, pts)) {
          mask[this.index(x, y)] = true;
        }
      }
    }
    return mask;
  }

  private pointInPolygon(
    px: number,
    py: number,
    pts: { x: number; y: number }[],
  ): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
      const xi = pts[i].x + 0.5;
      const yi = pts[i].y + 0.5;
      const xj = pts[j].x + 0.5;
      const yj = pts[j].y + 0.5;
      if (
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
      ) {
        inside = !inside;
      }
    }
    return inside;
  }

  private combineMask(
    base: boolean[],
    region: boolean[],
    mode: 'add' | 'subtract',
  ): boolean[] {
    const out = base.slice();
    for (let i = 0; i < out.length; i += 1) {
      if (region[i]) out[i] = mode !== 'subtract';
    }
    return out;
  }

  /** Expand a selection (bbox + optional mask) to a full-canvas boolean mask. */
  private selectionToCanvasMask(sel: Selection): boolean[] {
    const mask = new Array<boolean>(this.width * this.height).fill(false);
    for (let ry = 0; ry < sel.h; ry += 1) {
      for (let rx = 0; rx < sel.w; rx += 1) {
        if (sel.mask && !sel.mask[ry * sel.w + rx]) continue;
        const cx = sel.x + rx;
        const cy = sel.y + ry;
        if (this.inside(cx, cy)) mask[this.index(cx, cy)] = true;
      }
    }
    return mask;
  }

  /** Reduce a full-canvas mask to a bounding-box Selection (+ mask if not rect). */
  private canvasMaskToSelection(canvasMask: boolean[]): Selection | null {
    const W = this.width;
    const H = this.height;
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (canvasMask[this.index(x, y)]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const mask = new Array<boolean>(w * h).fill(false);
    let rect = true;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const on = canvasMask[this.index(minX + x, minY + y)];
        mask[y * w + x] = on;
        if (!on) rect = false;
      }
    }
    const sel: Selection = {
      x: minX,
      y: minY,
      w,
      h,
      pixels: [],
      mask: rect ? undefined : mask,
    };
    sel.pixels = this.copyPixels(sel);
    return sel;
  }

  // ===================== Free transform (scale / rotate / move) =====================

  /** Lift the current selection into a transform session. */
  private beginTransform(): void {
    if (!this.selection) return;
    const sel = this.normalizeSelection(this.selection);
    const src = this.selectionPixels(sel);
    const under = [...this.activeLayer.pixels];
    this.eachSelectionPixel(sel, (x, y) => this.setPixel(under, x, y, null));
    this.tf = {
      src,
      sw: sel.w,
      sh: sel.h,
      under,
      cx: sel.x + sel.w / 2,
      cy: sel.y + sel.h / 2,
      w: sel.w,
      h: sel.h,
      angle: 0,
    };
    this.selection = null;
    this.buildTransformPreview();
  }

  /** Bake the transform into the active layer and end the session. */
  commitTransform(): void {
    if (!this.tf) return;
    const buf = [...this.tf.under];
    this.rasterizeTransform(buf);
    this.pushUndo();
    this.activeLayer.pixels = buf;
    // New selection = footprint of the transformed pixels (as a mask).
    const canvasMask = buf.map((c, i) => c !== this.tf!.under[i] && c != null);
    this.tf = null;
    this.tfDrag = null;
    this.previewPixels = null;
    this.selection = this.canvasMaskToSelection(canvasMask);
    this.render();
  }

  /** Discard the transform, restoring the original pixels. */
  cancelTransform(): void {
    if (!this.tf) return;
    this.tf = null;
    this.tfDrag = null;
    this.previewPixels = null;
    this.render();
  }

  private buildTransformPreview(): void {
    if (!this.tf) return;
    const buf = [...this.tf.under];
    this.rasterizeTransform(buf);
    this.previewPixels = buf;
    this.render();
  }

  /** Inverse-map the source content into the rotated/scaled box. */
  private rasterizeTransform(buf: Pixel[]): void {
    const tf = this.tf!;
    const ux = Math.cos(tf.angle);
    const uy = Math.sin(tf.angle);
    const vx = -Math.sin(tf.angle);
    const vy = Math.cos(tf.angle);
    const hw = tf.w / 2;
    const hh = tf.h / 2;
    if (hw < 0.2 || hh < 0.2) return;
    const corners = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([a, b]) => [tf.cx + a * ux + b * vx, tf.cy + a * uy + b * vy]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const minX = Math.max(0, Math.floor(Math.min(...xs)));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(...xs)));
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    for (let py = minY; py <= maxY; py += 1) {
      for (let px = minX; px <= maxX; px += 1) {
        const dx = px + 0.5 - tf.cx;
        const dy = py + 0.5 - tf.cy;
        const a = dx * ux + dy * uy;
        const b = dx * vx + dy * vy;
        if (a < -hw || a > hw || b < -hh || b > hh) continue;
        let sx = Math.floor(((a + hw) / tf.w) * tf.sw);
        let sy = Math.floor(((b + hh) / tf.h) * tf.sh);
        sx = Math.min(tf.sw - 1, Math.max(0, sx));
        sy = Math.min(tf.sh - 1, Math.max(0, sy));
        const c = tf.src[sy * tf.sw + sx];
        if (c) buf[this.index(px, py)] = c;
      }
    }
  }

  /** Local handle offsets (canvas units) keyed by id. */
  private transformHandleLocals(): { id: string; a: number; b: number }[] {
    const hw = this.tf!.w / 2;
    const hh = this.tf!.h / 2;
    const rot = 14 / this.zoom; // ~14px above the top edge
    return [
      { id: 'nw', a: -hw, b: -hh },
      { id: 'n', a: 0, b: -hh },
      { id: 'ne', a: hw, b: -hh },
      { id: 'e', a: hw, b: 0 },
      { id: 'se', a: hw, b: hh },
      { id: 's', a: 0, b: hh },
      { id: 'sw', a: -hw, b: hh },
      { id: 'w', a: -hw, b: 0 },
      { id: 'rotate', a: 0, b: -hh - rot },
    ];
  }

  /** Convert a local (a,b) offset to canvas coords using the box angle. */
  private transformLocalToCanvas(a: number, b: number): { x: number; y: number } {
    const tf = this.tf!;
    const ux = Math.cos(tf.angle);
    const uy = Math.sin(tf.angle);
    const vx = -Math.sin(tf.angle);
    const vy = Math.cos(tf.angle);
    return { x: tf.cx + a * ux + b * vx, y: tf.cy + a * uy + b * vy };
  }

  /** Pointer down while the transform tool is active. */
  private transformPointerDown(event: PointerEvent): void {
    if (!this.tf) return;
    const p = this.eventToCanvasFloat(event);
    const z = this.zoom;
    // Hit-test handles in screen space (~10px radius).
    let hit: string | null = null;
    for (const h of this.transformHandleLocals()) {
      const c = this.transformLocalToCanvas(h.a, h.b);
      if (Math.hypot((c.x - p.x) * z, (c.y - p.y) * z) <= 10) {
        hit = h.id;
        break;
      }
    }
    // Inside box → move; outside with no handle → commit (click-away).
    const tf = this.tf;
    const ux = Math.cos(tf.angle);
    const uy = Math.sin(tf.angle);
    const vx = -Math.sin(tf.angle);
    const vy = Math.cos(tf.angle);
    const la = (p.x - tf.cx) * ux + (p.y - tf.cy) * uy;
    const lb = (p.x - tf.cx) * vx + (p.y - tf.cy) * vy;
    const inside = Math.abs(la) <= tf.w / 2 && Math.abs(lb) <= tf.h / 2;
    if (!hit && !inside) {
      this.commitTransform();
      return;
    }
    this.stageRef.nativeElement.setPointerCapture(event.pointerId);
    const mode: 'move' | 'scale' | 'rotate' =
      hit === 'rotate' ? 'rotate' : hit ? 'scale' : 'move';
    // For scale, the anchor is the opposite corner/edge (kept fixed).
    let anchorX = tf.cx;
    let anchorY = tf.cy;
    if (mode === 'scale' && hit) {
      const opp = this.transformOppositeLocal(hit);
      const c = this.transformLocalToCanvas(opp.a, opp.b);
      anchorX = c.x;
      anchorY = c.y;
    }
    this.tfDrag = {
      mode,
      handle: hit ?? 'move',
      pointerId: event.pointerId,
      startCx: tf.cx,
      startCy: tf.cy,
      startW: tf.w,
      startH: tf.h,
      startAngle: tf.angle,
      anchorX,
      anchorY,
      grabX: p.x,
      grabY: p.y,
    };
  }

  private transformOppositeLocal(id: string): { a: number; b: number } {
    const hw = this.tf!.w / 2;
    const hh = this.tf!.h / 2;
    const map: Record<string, [number, number]> = {
      nw: [hw, hh],
      n: [0, hh],
      ne: [-hw, hh],
      e: [-hw, 0],
      se: [-hw, -hh],
      s: [0, -hh],
      sw: [hw, -hh],
      w: [hw, 0],
    };
    const [a, b] = map[id] ?? [0, 0];
    return { a, b };
  }

  private transformPointerMove(event: PointerEvent): void {
    if (!this.tf || !this.tfDrag || this.tfDrag.pointerId !== event.pointerId)
      return;
    const p = this.eventToCanvasFloat(event);
    const d = this.tfDrag;
    const tf = this.tf;
    if (d.mode === 'move') {
      tf.cx = d.startCx + (p.x - d.grabX);
      tf.cy = d.startCy + (p.y - d.grabY);
    } else if (d.mode === 'rotate') {
      const ang = Math.atan2(p.y - tf.cy, p.x - tf.cx) + Math.PI / 2;
      tf.angle = ang;
    } else {
      // Scale: pointer offset from the fixed anchor, measured along box axes.
      const ux = Math.cos(tf.angle);
      const uy = Math.sin(tf.angle);
      const vx = -Math.sin(tf.angle);
      const vy = Math.cos(tf.angle);
      const pa = (p.x - d.anchorX) * ux + (p.y - d.anchorY) * uy;
      const pb = (p.x - d.anchorX) * vx + (p.y - d.anchorY) * vy;
      const sign: Record<string, [number, number]> = {
        nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
        se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
      };
      const [sa, sb] = sign[d.handle] ?? [0, 0];
      const newW = sa !== 0 ? Math.max(1, Math.abs(pa)) : d.startW;
      const newH = sb !== 0 ? Math.max(1, Math.abs(pb)) : d.startH;
      const dirA = sa !== 0 ? Math.sign(pa) || sa : 0;
      const dirB = sb !== 0 ? Math.sign(pb) || sb : 0;
      const offA = sa !== 0 ? (dirA * newW) / 2 : 0;
      const offB = sb !== 0 ? (dirB * newH) / 2 : 0;
      tf.w = newW;
      tf.h = newH;
      tf.cx = d.anchorX + offA * ux + offB * vx;
      tf.cy = d.anchorY + offA * uy + offB * vy;
    }
    this.buildTransformPreview();
  }

  private transformPointerUp(event: PointerEvent): void {
    if (this.tfDrag && this.tfDrag.pointerId === event.pointerId) {
      this.tfDrag = null;
    }
  }

  /** Pointer position in floating-point canvas (pixel) coordinates. */
  private eventToCanvasFloat(event: PointerEvent): { x: number; y: number } {
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / this.zoom,
      y: (event.clientY - rect.top) / this.zoom,
    };
  }

  private pushUndo(): void {
    this.undoStack.push(this.serialize());
    this.undoStack = this.undoStack.slice(-80);
    this.redoStack = [];
    if (this.recording) this.captureTimelapseFrame();
  }

  // ===================== Timelapse recording =====================

  toggleRecording(): void {
    this.recording = !this.recording;
    if (this.recording) {
      this.timelapseFrames = [];
      this.timelapseLimitHit = false;
      this.captureTimelapseFrame();
    }
  }

  private captureTimelapseFrame(): void {
    if (!this.isBrowser) return;
    this.timelapseFrames.push(this.renderFrameCanvas(this.activeFrameIndex, 1));
    if (this.timelapseFrames.length > EditorComponent.MAX_TIMELAPSE_FRAMES) {
      this.timelapseFrames.shift();
      if (!this.timelapseLimitHit) {
        this.timelapseLimitHit = true;
        this.notify.info(
          this.locale.t('notify.timelapseFull', { max: EditorComponent.MAX_TIMELAPSE_FRAMES }),
          { sticky: true },
        );
      }
    }
  }

  /** Encode the recorded frames into a shareable GIF (free, watermarked). */
  async exportTimelapse(): Promise<void> {
    this.fileMenuOpen = false;
    this.captureTimelapseFrame();
    if (this.timelapseFrames.length < 2) {
      this.notify.info(this.locale.t('notify.timelapseNeedFrames'));
      return;
    }
    await this.encodeTimelapseGif(this.timelapseFrames);
  }

  /**
   * Reconstruct a timelapse GIF from the in-memory undo history when recording
   * was never turned on. Best-effort: limited to the snapshots still in the
   * undo stack (this session only — lost on reload).
   */
  async exportTimelapseFromHistory(): Promise<void> {
    this.fileMenuOpen = false;
    // Oldest → newest: each undo snapshot is the state before an edit, plus the live state.
    const snapshots = [...this.undoStack, this.serialize()];
    if (snapshots.length < 2) {
      this.notify.info(this.locale.t('notify.timelapseNeedHistory'));
      return;
    }
    const frames = this.renderSnapshotFrames(snapshots);
    if (frames.length < 2) return;
    await this.encodeTimelapseGif(frames);
  }

  /** Render each serialized snapshot's active frame to a 1× canvas, restoring live state after. */
  private renderSnapshotFrames(snapshots: string[]): HTMLCanvasElement[] {
    const savedFrames = this.frames;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const savedGroups = this.groups;
    const savedPreview = this.previewPixels;
    this.previewPixels = null;
    const out: HTMLCanvasElement[] = [];
    try {
      for (const snap of snapshots) {
        const state = JSON.parse(snap);
        this.width = state.width;
        this.height = state.height;
        this.frames = state.frames;
        this.groups = state.groups ?? [];
        const fi = Math.min(
          state.activeFrameIndex ?? 0,
          state.frames.length - 1,
        );
        out.push(this.renderFrameCanvas(fi, 1));
      }
    } finally {
      this.frames = savedFrames;
      this.width = savedWidth;
      this.height = savedHeight;
      this.groups = savedGroups;
      this.previewPixels = savedPreview;
    }
    return out;
  }

  /** Encode a sequence of frame canvases into a watermarked, video-friendly GIF. */
  private async encodeTimelapseGif(sources: HTMLCanvasElement[]): Promise<void> {
    if (this.exportBusy) return;
    this.exportBusy = true;
    try {
      const first = sources[0];
      const scale = Math.max(
        1,
        Math.floor(384 / Math.max(first.width, first.height)),
      );
      const w = first.width * scale;
      const h = first.height * scale;
      const gif = GIFEncoder();
      this.exportProgress = { done: 0, total: sources.length };
      for (let i = 0; i < sources.length; i += 1) {
        this.exportProgress = { done: i, total: sources.length };
        // Timelapses can be hundreds of frames — yield periodically so the UI repaints.
        if (i % 5 === 0) await new Promise<void>((r) => setTimeout(r));
        const src = sources[i];
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = false;
        // Solid background so the clip isn't transparent — video editors (CapCut,
        // etc.) ignore GIF alpha and would otherwise show it as black.
        ctx.fillStyle = this.videoBg;
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, w, h);
        this.stampWatermark(ctx, w, h);
        // Linger on the final frame so the result is readable in a loop.
        const last = i === sources.length - 1;
        this.writeGifFrame(gif, ctx, w, h, last ? 1200 : 90);
      }
      gif.finish();
      this.downloadBlob(
        new Blob([gif.bytes()], { type: 'image/gif' }),
        `${this.exportBaseName()}-timelapse.gif`,
      );
      this.notify.success(this.locale.t('export.timelapseDone'));
    } finally {
      this.exportBusy = false;
      this.exportProgress = null;
    }
  }

  private serialize(): string {
    return JSON.stringify({
      width: this.width,
      height: this.height,
      frames: this.frames,
      tags: this.tags,
      groups: this.groups,
      activeFrameIndex: this.activeFrameIndex,
      activeLayerIndex: this.activeLayerIndex,
      palette: this.palette,
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      symmetry: this.symmetry,
    });
  }

  private restore(snapshot: string): void {
    const state = JSON.parse(snapshot);
    this.width = state.width;
    this.height = state.height;
    this.frames = state.frames;
    this.tags = state.tags ?? [];
    this.groups = state.groups ?? [];
    this.activeFrameIndex = state.activeFrameIndex;
    this.activeLayerIndex = state.activeLayerIndex;
    this.palette = state.palette;
    this.primaryColor = state.primaryColor;
    this.secondaryColor = state.secondaryColor;
    this.symmetry = state.symmetry ?? this.symmetry;
    this.selection = null;
    this.previewPixels = null;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  private playNextFrame(): void {
    if (!this.isPlaying) {
      return;
    }
    if (!this.frames.some((frame) => frame.visible)) {
      this.isPlaying = false;
      return;
    }
    const tag = this.playingTag;
    let next: number;
    if (tag) {
      next = this.nextFrameInTag(this.previewFrameIndex, tag);
      if (next < 0) {
        this.isPlaying = false;
        this.previewFrameIndex = this.activeFrameIndex;
        this.render();
        return;
      }
    } else {
      next = this.findNextVisibleFrameIndex(this.previewFrameIndex);
      // When looping is off, stop once we wrap past the last frame.
      if (!this.loop && next <= this.previewFrameIndex) {
        this.isPlaying = false;
        this.previewFrameIndex = this.activeFrameIndex;
        this.render();
        return;
      }
    }
    this.previewFrameIndex = next;
    this.render();
    this.animationTimer = window.setTimeout(
      () => this.playNextFrame(),
      this.frames[this.previewFrameIndex].duration,
    );
  }

  /** Next frame within a tag's range, honoring its direction. -1 = stop. */
  private nextFrameInTag(current: number, tag: AnimTag): number {
    const max = this.frames.length - 1;
    const lo = this.clamp(Math.min(tag.from, tag.to), 0, max);
    const hi = this.clamp(Math.max(tag.from, tag.to), 0, max);
    if (hi <= lo) return lo;
    const pos = this.clamp(current, lo, hi);
    switch (tag.direction) {
      case 'reverse': {
        const n = pos - 1;
        if (n < lo) return this.loop ? hi : -1;
        return n;
      }
      case 'pingpong': {
        let n = pos + this.playDirection;
        if (n > hi) {
          this.playDirection = -1;
          n = hi - 1;
        } else if (n < lo) {
          if (!this.loop) return -1;
          this.playDirection = 1;
          n = lo + 1;
        }
        return n;
      }
      default: {
        const n = pos + 1;
        if (n > hi) return this.loop ? lo : -1;
        return n;
      }
    }
  }

  toggleLoop(): void {
    this.loop = !this.loop;
  }

  /** Step the active frame backwards/forwards (wraps), pausing playback. */
  stepFrame(delta: number): void {
    if (this.isPlaying) {
      this.togglePlayback();
    }
    const n = this.frames.length;
    this.selectFrame(((this.activeFrameIndex + delta) % n + n) % n);
  }

  /** Apply the FPS value to every frame's duration. */
  applyFps(): void {
    const fps = this.clamp(Math.round(this.fps) || 1, 1, 60);
    this.fps = fps;
    const duration = Math.max(20, Math.round(1000 / fps));
    for (const frame of this.frames) {
      frame.duration = duration;
    }
    this.render();
  }

  private findNextVisibleFrameIndex(currentIndex: number): number {
    if (!this.frames.length) {
      return 0;
    }
    for (let step = 1; step <= this.frames.length; step += 1) {
      const index = (currentIndex + step) % this.frames.length;
      if (this.frames[index].visible) {
        return index;
      }
    }
    return currentIndex;
  }

  private compositeAt(x: number, y: number): string | null {
    for (let i = this.activeFrame.layers.length - 1; i >= 0; i -= 1) {
      const layer = this.activeFrame.layers[i];
      const color = this.layerEffectivelyVisible(layer)
        ? layer.pixels[this.index(x, y)]
        : null;
      if (color) {
        return color;
      }
    }
    return null;
  }

  private setPixel(buffer: Pixel[], x: number, y: number, color: Pixel): void {
    if (this.inside(x, y)) {
      buffer[this.index(x, y)] = color;
    }
  }

  private setMirroredPixel(
    buffer: Pixel[],
    x: number,
    y: number,
    color: Pixel,
  ): void {
    for (const p of this.symmetricPoints(x, y)) {
      this.setPixel(buffer, p.x, p.y, color);
    }
  }

  /** All symmetry images of a cell (including itself), de-duplicated. */
  private symmetricPoints(x: number, y: number): { x: number; y: number }[] {
    const mx = this.width - 1 - x;
    const my = this.height - 1 - y;
    const pts: { x: number; y: number }[] = [{ x, y }];
    const add = (px: number, py: number) => {
      if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
      if (!pts.some((q) => q.x === px && q.y === py)) pts.push({ x: px, y: py });
    };
    switch (this.symmetry) {
      case 'x':
        add(mx, y);
        break;
      case 'y':
        add(x, my);
        break;
      case 'both':
        add(mx, y);
        add(x, my);
        add(mx, my);
        break;
      case 'mandala':
        add(mx, y);
        add(x, my);
        add(mx, my);
        // 8-fold radial needs a square canvas to swap axes meaningfully.
        if (this.width === this.height) {
          add(y, x);
          add(my, x);
          add(y, mx);
          add(my, mx);
        }
        break;
    }
    return pts;
  }

  private mirrorPixelX(x: number): number {
    return this.width - 1 - x;
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }

  private inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}
