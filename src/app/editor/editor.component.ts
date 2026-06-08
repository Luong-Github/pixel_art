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
  | 'picker'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'select'
  | 'move';
type Pixel = string | null;
type ImportFit = 'contain' | 'cover' | 'stretch';

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

interface Layer {
  name: string;
  visible: boolean;
  locked?: boolean;
  opacity: number;
  pixels: Pixel[];
}

interface Frame {
  name: string;
  duration: number;
  visible: boolean;
  layers: Layer[];
}

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Pixel[];
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

interface WorkspaceState {
  id: number;
  name: string;
  width: number;
  height: number;
  frames: Frame[];
  activeFrameIndex: number;
  activeLayerIndex: number;
  palette: string[];
  primaryColor: string;
  secondaryColor: string;
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
  imports: [CommonModule, FormsModule, RouterLink, DragDropModule, DockPanelDefDirective],
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
  convertModalOpen = false;
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
    private hostRef: ElementRef<HTMLElement>,
    private sanitizer: DomSanitizer,
    @Inject(PLATFORM_ID) platformId: object,
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
    this.buildToolIcons();
    this.buildUiIcons();
    this.loadSavedPalettes();
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
    this.fileMenuOpen = !this.fileMenuOpen;
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
  startImageImport(): void {
    if (
      this.importTarget === 'current' &&
      this.workspaceInProgress &&
      !window.confirm(
        'This tab already has artwork. Overwrite it with the imported image?\n\n' +
          'Tip: choose "New tab" to keep your current work.',
      )
    ) {
      return;
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
      picker: `${s}<path d="M3 21l1-4 9.5-9.5 3 3L7 20z"/><path d="M14.5 4.5l2-2a2.1 2.1 0 0 1 3 3l-2 2"/></svg>`,
      line: `${s}<line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="5" r="1.4" fill="currentColor"/></svg>`,
      rect: `${s}<rect x="4" y="5" width="16" height="14" rx="1"/></svg>`,
      ellipse: `${s}<circle cx="12" cy="12" r="8"/></svg>`,
      select: `${s.replace('stroke-width="2"', 'stroke-width="2" stroke-dasharray="3 3"')}<rect x="4" y="4" width="16" height="16" rx="1"/></svg>`,
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
    { id: 'picker', label: 'Pick', key: 'I' },
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'rect', label: 'Rect', key: 'R' },
    { id: 'ellipse', label: 'Oval', key: 'O' },
    { id: 'select', label: 'Select', key: 'S' },
    { id: 'move', label: 'Move', key: 'M' },
  ];

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
  mirrorX = false;
  activeTool: Tool = 'pen';
  primaryColor = '#222831';
  secondaryColor = '#f6f1de';
  brushSize = 1;
  /** Restrict drawing to the active palette's colours when on. */
  paletteLock = false;
  /** Dither brush: 'off' or fill ratio 25/50/75 (primary vs secondary). */
  ditherMode: 'off' | '25' | '50' | '75' = 'off';
  /** Pivot/anchor for sprite-sheet export (and on-canvas marker). */
  pivotPreset: 'center' | 'feet' | 'topleft' = 'feet';
  /** Sprite-sheet columns; 0 = auto (square-ish grid). */
  sheetColumns = 0;
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
  private pointer: PointerState | null = null;
  private selection: Selection | null = null;
  private clipboard: Selection | null = null;
  private previewPixels: Pixel[] | null = null;
  private moveStartSelection: Selection | null = null;
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
    return `auto auto minmax(0, 1fr) auto`;
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
    void this.loadIdlePresetExample();
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
    this.panelsMenuOpen = !this.panelsMenuOpen;
  }

  // ---- floating window drag / resize (pointer based) ----------------------

  beginFloatDrag(event: PointerEvent, id: PanelId, mode: 'move' | 'resize'): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const f = this.dock.floatOf(id);
    if (!f) return;
    this.dock.bringToFront(id);
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
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

  @HostListener('window:pointermove', ['$event'])
  onFloatPointerMove(event: PointerEvent): void {
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

  @HostListener('window:pointerup', ['$event'])
  onFloatPointerUp(event: PointerEvent): void {
    if (!this.floatDrag || this.floatDrag.pointerId !== event.pointerId) return;
    const drag = this.floatDrag;
    this.floatDrag = null;
    this.dragActive = false;
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
    const workspace = this.createBlankWorkspace(`Workspace ${id}`, id);
    this.workspaces.push(workspace);
    this.activeWorkspaceIndex = this.workspaces.length - 1;
    this.applyWorkspace(workspace);
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

  selectWorkspace(index: number): void {
    if (index === this.activeWorkspaceIndex) {
      return;
    }
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

  setTool(tool: Tool): void {
    this.activeTool = tool;
    if (tool !== 'move') {
      this.previewPixels = null;
    }
    this.render();
  }

  newSprite(): void {
    this.pushUndo();
    this.width = this.clamp(Math.floor(this.width), 8, 128);
    this.height = this.clamp(Math.floor(this.height), 8, 128);
    this.frames = [this.createFrame('Frame 1')];
    this.activeFrameIndex = 0;
    this.activeLayerIndex = 0;
    this.selection = null;
    this.render();
  }

  addLayer(): void {
    this.pushUndo();
    const name = `Layer ${this.timelineLayerCount + 1}`;
    for (const frame of this.frames) {
      frame.layers.push(this.createLayer(name));
    }
    this.activeLayerIndex = this.timelineLayerCount - 1;
    this.render();
  }

  duplicateLayer(): void {
    this.pushUndo();
    for (const frame of this.frames) {
      const source =
        frame.layers[this.activeLayerIndex] ??
        this.createLayer(`Layer ${this.activeLayerIndex + 1}`);
      frame.layers.splice(this.activeLayerIndex + 1, 0, {
        name: `${source.name} copy`,
        visible: source.visible,
        locked: source.locked ?? false,
        opacity: source.opacity,
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

  addFrame(): void {
    this.pushUndo();
    this.frames.splice(
      this.activeFrameIndex + 1,
      0,
      this.createFrame(`Frame ${this.frames.length + 1}`),
    );
    this.activeFrameIndex += 1;
    this.activeLayerIndex = 0;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  duplicateFrame(): void {
    this.pushUndo();
    const copy = this.cloneFrame(
      this.activeFrame,
      `${this.activeFrame.name} copy`,
    );
    this.frames.splice(this.activeFrameIndex + 1, 0, copy);
    this.activeFrameIndex += 1;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  deleteFrame(): void {
    if (this.frames.length === 1) {
      this.clearLayer();
      return;
    }
    this.pushUndo();
    this.frames.splice(this.activeFrameIndex, 1);
    this.activeFrameIndex = Math.max(0, this.activeFrameIndex - 1);
    this.activeLayerIndex = Math.min(
      this.activeLayerIndex,
      this.activeFrame.layers.length - 1,
    );
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Insert a blank frame before or after the active one. */
  insertFrame(after: boolean): void {
    this.pushUndo();
    const at = this.activeFrameIndex + (after ? 1 : 0);
    this.frames.splice(at, 0, this.createFrame(`Frame ${this.frames.length + 1}`));
    this.activeFrameIndex = at;
    this.previewFrameIndex = at;
    this.activeLayerIndex = 0;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  /** Reverse the order of all frames (e.g. to ping-pong an animation). */
  reverseFrames(): void {
    if (this.frames.length < 2) {
      return;
    }
    this.pushUndo();
    this.frames.reverse();
    this.activeFrameIndex = this.frames.length - 1 - this.activeFrameIndex;
    this.previewFrameIndex = this.activeFrameIndex;
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

  togglePlayback(): void {
    this.isPlaying = !this.isPlaying;
    if (!this.isPlaying) {
      window.clearTimeout(this.animationTimer);
      this.previewFrameIndex = this.activeFrameIndex;
      this.render();
      return;
    }
    this.playNextFrame();
  }

  onPointerDown(event: PointerEvent): void {
    if (this.shouldPanCanvas(event)) {
      this.beginPan(event);
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

    // Locked layer: block all editing, including drag-painting. Don't capture
    // the pointer or set pointer state, so pointermove/up do nothing either.
    if (this.activeLayerLocked) {
      return;
    }

    this.stageRef.nativeElement.setPointerCapture(event.pointerId);
    this.pointer = { ...point, startX: point.x, startY: point.y };

    this.pushUndo();
    if (this.activeTool === 'pen' || this.activeTool === 'eraser') {
      this.paint(point.x, point.y);
    } else if (this.activeTool === 'fill') {
      this.fillMirrored(point.x, point.y, this.effectivePrimary);
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
    if (!this.pointer) {
      return;
    }
    const point = this.eventToPixel(event);
    if (!point) {
      return;
    }

    if (this.activeTool === 'pen' || this.activeTool === 'eraser') {
      this.drawLine(this.pointer.x, this.pointer.y, point.x, point.y, (x, y) =>
        this.paint(x, y),
      );
      this.pointer.x = point.x;
      this.pointer.y = point.y;
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
    } else if (this.activeTool === 'select' && this.selection) {
      this.selection = this.normalizeSelection(this.selection);
      this.selection.pixels = this.copyPixels(this.selection);
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
    const image = await this.loadImage(file);
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
    this.exportMenuOpen = !this.exportMenuOpen;
  }

  /** Free users keep PNG @1x/@2x (watermarked); the rest is Pro. */
  private requirePro(feature: string): boolean {
    if (this.premium.isPro) return true;
    const go = window.confirm(
      `${feature} is a Pro feature.\n\nEnter a license key to unlock Pro? (demo key: PIXELPRO)`,
    );
    if (go) this.promptActivatePro();
    return false;
  }

  promptActivatePro(): void {
    const key = window.prompt('Enter your Pro license key (demo: PIXELPRO):', '');
    if (key == null) return;
    if (this.premium.activate(key)) {
      window.alert('Pro unlocked. Thank you! ✦');
    } else {
      window.alert('That key was not recognised.');
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
  exportPngScale(scale: number): void {
    this.exportMenuOpen = false;
    if (scale > 2 && !this.requirePro(`PNG @${scale}x export`)) return;
    const canvas = this.renderFrameCanvas(this.activeFrameIndex, scale);
    const ctx = canvas.getContext('2d');
    if (ctx) this.stampWatermark(ctx, canvas.width, canvas.height);
    this.downloadCanvas(canvas, `pixel-art-${this.width}x${this.height}@${scale}x.png`);
  }

  /** Pack every (visible) frame into a sprite sheet PNG + engine-ready JSON atlas. */
  exportSpriteSheet(layout: 'grid' | 'row' = 'grid', scale = 1): void {
    this.exportMenuOpen = false;
    if (!this.requirePro('Sprite sheet export')) return;
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
    };
    this.downloadBlob(
      new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' }),
      `${base}.json`,
    );
  }

  /** Export the (visible) frames as an animated GIF at the given scale. */
  exportGif(scale = 1): void {
    this.exportMenuOpen = false;
    if (!this.requirePro('Animated GIF export')) return;
    const indices = this.exportFrameIndices();
    const gif = GIFEncoder();
    for (const frameIndex of indices) {
      const canvas = this.renderFrameCanvas(frameIndex, scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const palette = quantize(data, 256, { format: 'rgba4444' });
      const index = applyPalette(data, palette, 'rgba4444');
      const delay = Math.max(20, Math.round(this.frames[frameIndex]?.duration ?? 100));
      gif.writeFrame(index, width, height, {
        palette,
        delay,
        transparent: true,
        transparentIndex: 0,
        dispose: 2,
      });
    }
    gif.finish();
    this.downloadBlob(
      new Blob([gif.bytes()], { type: 'image/gif' }),
      `${this.exportBaseName()}.gif`,
    );
  }

  private exportBaseName(): string {
    return (
      this.activeWorkspace.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'pixel-art'
    );
  }

  exportProject(): void {
    this.saveCurrentWorkspace();
    const project: PixelArtProjectFile = {
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
        mirrorX: this.mirrorX,
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

  triggerProjectImport(): void {
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
      this.loadProject(project);
    } finally {
      input.value = '';
    }
  }

  selectFrame(index: number): void {
    this.activeFrameIndex = index;
    this.previewFrameIndex = index;
    this.activeLayerIndex = Math.min(
      this.activeLayerIndex,
      this.activeFrame.layers.length - 1,
    );
    this.render();
  }

  selectLayer(index: number): void {
    this.activeLayerIndex = index;
    this.render();
  }

  get activeLayerLocked(): boolean {
    return !!this.activeLayer?.locked;
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

  /** Drag-and-drop reorder a frame (column) to a new position. */
  onFrameDrop(event: CdkDragDrop<unknown>): void {
    const from = event.previousIndex;
    const to = event.currentIndex;
    if (from === to) return;
    this.pushUndo();
    moveItemInArray(this.frames, from, to);
    this.activeFrameIndex = to;
    this.previewFrameIndex = to;
    this.refreshAllFrameThumbnails();
    this.render();
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

  selectTimelineCell(frameIndex: number, layerIndex: number): void {
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
  saveCurrentPalette(): void {
    const name = window.prompt('Name this palette:', `Palette ${this.savedPalettes.length + 1}`);
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
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
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
    if (event.target instanceof HTMLInputElement) {
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.isSpacePanning = true;
      return;
    }
    const key = event.key.toLowerCase();
    const tool = this.tools.find((item) => item.key.toLowerCase() === key);
    if (tool) {
      this.setTool(tool.id);
    } else if (event.ctrlKey && key === 'z') {
      event.preventDefault();
      this.undo();
    } else if (event.ctrlKey && key === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.ctrlKey && key === 'c') {
      event.preventDefault();
      this.copySelection();
    } else if (event.ctrlKey && key === 'x') {
      event.preventDefault();
      this.cutSelection();
    } else if (event.ctrlKey && key === 'v') {
      event.preventDefault();
      this.pasteSelection();
    } else if (key === 'delete') {
      this.cutSelection();
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
      activeFrameIndex: this.activeFrameIndex,
      activeLayerIndex: this.activeLayerIndex,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
    };
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
    this.clipboard = null;
    this.previewPixels = null;
    this.moveStartSelection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.previewFrameIndex = this.activeFrameIndex;
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
      activeFrameIndex: 0,
      activeLayerIndex: 0,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
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
      this.mirrorX = settings.mirrorX ?? this.mirrorX;
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
        pixels: this.normalizePixels(layer.pixels, pixelCount),
      })),
    }));
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
    };
  }

  private cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
    return {
      ...workspace,
      frames: workspace.frames.map((frame) =>
        this.cloneFrame(frame, frame.name),
      ),
      palette: [...workspace.palette],
    };
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

  private createLayer(name: string): Layer {
    return {
      name,
      visible: true,
      locked: false,
      opacity: 1,
      pixels: new Array<Pixel>(this.width * this.height).fill(null),
    };
  }

  private cloneFrame(frame: Frame, name: string): Frame {
    return {
      name,
      duration: frame.duration,
      visible: frame.visible,
      layers: frame.layers.map((layer) => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
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

  private fillMirrored(x: number, y: number, replacement: Pixel): void {
    this.floodFill(
      x,
      y,
      this.activeLayer.pixels[this.index(x, y)],
      replacement,
    );
    if (!this.mirrorX) {
      return;
    }
    const mirrorX = this.mirrorPixelX(x);
    if (mirrorX !== x) {
      this.floodFill(
        mirrorX,
        y,
        this.activeLayer.pixels[this.index(mirrorX, y)],
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
    if (useSecondary) {
      this.secondaryColor = color;
    } else {
      this.primaryColor = color;
    }
    this.addPaletteColor(color);
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
    canvas.width = this.canvasWidth;
    canvas.height = this.canvasHeight;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#f7f7f7';
    this.ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.drawCheckerboard();

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
      this.drawPixels(
        this.ctx,
        this.previewPixels,
        this.zoom,
        this.activeLayer.opacity,
      );
    }
    if (this.showGrid) {
      this.drawGrid();
    }
    if (this.mirrorX) {
      this.drawMirrorGuide();
    }
    this.drawPivot();
    if (this.selection) {
      this.drawSelection();
    }
    this.renderDisplay();
    this.refreshActiveFrameThumbnail();
  }

  private renderDisplay(): void {
    if (!this.displayCtx || !this.displayRef) {
      return;
    }
    const canvas = this.displayRef.nativeElement;
    canvas.width = this.displayCanvasWidth;
    canvas.height = this.displayCanvasHeight;
    this.displayCtx.imageSmoothingEnabled = false;
    this.drawCheckerboardTo(this.displayCtx, this.displayZoom);
    this.drawComposite(
      this.displayCtx,
      this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex,
      this.displayZoom,
      true,
    );
    if (this.previewPixels) {
      this.drawPixels(
        this.displayCtx,
        this.previewPixels,
        this.displayZoom,
        this.activeLayer.opacity,
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
      if (layer.visible) {
        this.drawPixels(ctx, layer.pixels, scale, layer.opacity);
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
        !layer.visible ||
        (skipActivePreview &&
          this.previewPixels &&
          index === this.activeLayerIndex)
      ) {
        return;
      }
      this.drawPixels(ctx, layer.pixels, scale, layer.opacity);
    });
  }

  private drawPixels(
    ctx: CanvasRenderingContext2D,
    pixels: Pixel[],
    scale: number,
    opacity: number,
  ): void {
    ctx.globalAlpha = opacity;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const color = pixels[this.index(x, y)];
        if (!color) {
          continue;
        }
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCheckerboard(): void {
    this.drawCheckerboardTo(this.ctx, this.zoom);
  }

  private drawCheckerboardTo(
    ctx: CanvasRenderingContext2D,
    cell: number,
  ): void {
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#ffffff' : '#e8ecef';
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
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

  private drawMirrorGuide(): void {
    const centerX = this.canvasWidth / 2;

    this.ctx.save();
    this.ctx.lineWidth = 3;
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.beginPath();
    this.ctx.moveTo(centerX, 0);
    this.ctx.lineTo(centerX, this.canvasHeight);
    this.ctx.stroke();

    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([
      Math.max(4, Math.floor(this.zoom * 0.45)),
      Math.max(3, Math.floor(this.zoom * 0.3)),
    ]);
    this.ctx.strokeStyle = '#e85d75';
    this.ctx.beginPath();
    this.ctx.moveTo(centerX + 0.5, 0);
    this.ctx.lineTo(centerX + 0.5, this.canvasHeight);
    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawSelection(): void {
    if (!this.selection) {
      return;
    }
    this.ctx.strokeStyle = '#111827';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 4]);
    this.ctx.strokeRect(
      this.selection.x * this.zoom + 1,
      this.selection.y * this.zoom + 1,
      this.selection.w * this.zoom - 2,
      this.selection.h * this.zoom - 2,
    );
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
        this.setPixel(
          buffer,
          selection.x + x,
          selection.y + y,
          selection.pixels[y * selection.w + x],
        );
      }
    }
  }

  private copyPixels(selection: Selection): Pixel[] {
    const pixels: Pixel[] = [];
    for (let y = 0; y < selection.h; y += 1) {
      for (let x = 0; x < selection.w; x += 1) {
        const sourceX = selection.x + x;
        const sourceY = selection.y + y;
        pixels.push(
          this.inside(sourceX, sourceY)
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

  private eachSelectionPixel(
    selection: Selection,
    fn: (x: number, y: number) => void,
  ): void {
    for (let y = selection.y; y < selection.y + selection.h; y += 1) {
      for (let x = selection.x; x < selection.x + selection.w; x += 1) {
        fn(x, y);
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

  private pushUndo(): void {
    this.undoStack.push(this.serialize());
    this.undoStack = this.undoStack.slice(-80);
    this.redoStack = [];
  }

  private serialize(): string {
    return JSON.stringify({
      width: this.width,
      height: this.height,
      frames: this.frames,
      activeFrameIndex: this.activeFrameIndex,
      activeLayerIndex: this.activeLayerIndex,
      palette: this.palette,
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor,
      mirrorX: this.mirrorX,
    });
  }

  private restore(snapshot: string): void {
    const state = JSON.parse(snapshot);
    this.width = state.width;
    this.height = state.height;
    this.frames = state.frames;
    this.activeFrameIndex = state.activeFrameIndex;
    this.activeLayerIndex = state.activeLayerIndex;
    this.palette = state.palette;
    this.primaryColor = state.primaryColor;
    this.secondaryColor = state.secondaryColor;
    this.mirrorX = state.mirrorX ?? this.mirrorX;
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
    const next = this.findNextVisibleFrameIndex(this.previewFrameIndex);
    // When looping is off, stop once we wrap past the last frame.
    if (!this.loop && next <= this.previewFrameIndex) {
      this.isPlaying = false;
      this.previewFrameIndex = this.activeFrameIndex;
      this.render();
      return;
    }
    this.previewFrameIndex = next;
    this.render();
    this.animationTimer = window.setTimeout(
      () => this.playNextFrame(),
      this.frames[this.previewFrameIndex].duration,
    );
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
      const color = layer.visible ? layer.pixels[this.index(x, y)] : null;
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
    this.setPixel(buffer, x, y, color);
    if (this.mirrorX) {
      this.setPixel(buffer, this.mirrorPixelX(x), y, color);
    }
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
