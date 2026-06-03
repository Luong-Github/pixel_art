import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements AfterViewInit {
  @ViewChild('stage', { static: true })
  stageRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('display', { static: true })
  displayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasWrap', { static: true })
  canvasWrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild('importInput', { static: true })
  importInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('projectInput', { static: true })
  projectInputRef!: ElementRef<HTMLInputElement>;

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
  zoom = 18;
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
  mirrorX = false;
  activeTool: Tool = 'pen';
  primaryColor = '#222831';
  secondaryColor = '#f6f1de';
  brushSize = 1;
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

  get studioGridColumns(): string {
    return `${this.leftPanelWidth}px 6px minmax(0, 1fr) 6px ${this.rightPanelWidth}px`;
  }

  get workspaceGridRows(): string {
    return `auto auto minmax(0, 1fr) auto ${this.timelineCollapsed ? '0' : '6px'} ${this.timelineCollapsed ? '56px' : `${this.bottomPanelHeight}px`}`;
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
    const ctx = this.stageRef.nativeElement.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas is not available.');
    }
    const displayCtx = this.displayRef.nativeElement.getContext('2d');
    if (!displayCtx) {
      throw new Error('Preview canvas is not available.');
    }
    this.ctx = ctx;
    this.displayCtx = displayCtx;
    this.render();
    void this.loadIdlePresetExample();
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

  clearLayer(): void {
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
    this.stageRef.nativeElement.setPointerCapture(event.pointerId);
    this.pointer = { ...point, startX: point.x, startY: point.y };

    if (this.activeTool === 'picker') {
      const color = this.compositeAt(point.x, point.y);
      if (color) {
        this.applyPickedColor(color, event.button === 2 || event.altKey);
      }
      return;
    }

    this.pushUndo();
    if (this.activeTool === 'pen' || this.activeTool === 'eraser') {
      this.paint(point.x, point.y);
    } else if (this.activeTool === 'fill') {
      this.fillMirrored(point.x, point.y, this.primaryColor);
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
    this.zoom = this.clamp(this.zoom + (event.deltaY < 0 ? 1 : -1), 6, 32);
    if (this.zoom === previousZoom) {
      return;
    }
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
    if (!this.selection) {
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

  exportPng(): void {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.width;
    exportCanvas.height = this.height;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) {
      return;
    }
    this.drawComposite(exportCtx, this.activeFrameIndex, 1, false);
    const link = document.createElement('a');
    link.download = `pixel-art-${this.width}x${this.height}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }

  exportScaledPng(): void {
    const scale = Math.max(1, this.zoom);
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.width * scale;
    exportCanvas.height = this.height * scale;
    const exportCtx = exportCanvas.getContext('2d');
    if (!exportCtx) {
      return;
    }
    exportCtx.imageSmoothingEnabled = false;
    this.drawComposite(exportCtx, this.activeFrameIndex, scale, false);
    const link = document.createElement('a');
    link.download = `pixel-art-${this.width}x${this.height}-${scale}x.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
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
    ].slice(0, 32);
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
      this.zoom = this.clamp(settings.zoom ?? this.zoom, 6, 32);
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
    for (let oy = 0; oy < radius; oy += 1) {
      for (let ox = 0; ox < radius; ox += 1) {
        this.setMirroredPixel(
          this.activeLayer.pixels,
          x + ox,
          y + oy,
          this.activeTool === 'eraser' ? null : this.primaryColor,
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
    if (tool === 'line') {
      this.drawLine(x0, y0, x1, y1, (x, y) =>
        this.setMirroredPixel(buffer, x, y, this.primaryColor),
      );
    } else if (tool === 'rect') {
      const rect = this.normalizeSelection(this.rectFromPoints(x0, y0, x1, y1));
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        this.setMirroredPixel(buffer, x, rect.y, this.primaryColor);
        this.setMirroredPixel(
          buffer,
          x,
          rect.y + rect.h - 1,
          this.primaryColor,
        );
      }
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        this.setMirroredPixel(buffer, rect.x, y, this.primaryColor);
        this.setMirroredPixel(
          buffer,
          rect.x + rect.w - 1,
          y,
          this.primaryColor,
        );
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
            this.setMirroredPixel(buffer, x, y, this.primaryColor);
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

    if (this.onionSkin && this.activeFrameIndex > 0) {
      this.ctx.globalAlpha = 0.25;
      this.drawComposite(this.ctx, this.activeFrameIndex - 1, this.zoom, false);
      this.ctx.globalAlpha = 1;
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
    if (this.selection) {
      this.drawSelection();
    }
    this.renderDisplay();
    this.refreshActiveFrameThumbnail();
  }

  private renderDisplay(): void {
    if (!this.displayCtx) {
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
    this.previewFrameIndex = this.findNextVisibleFrameIndex(
      this.previewFrameIndex,
    );
    this.render();
    this.animationTimer = window.setTimeout(
      () => this.playNextFrame(),
      this.frames[this.previewFrameIndex].duration,
    );
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
