import { AfterViewInit, Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

type Tool = 'pen' | 'eraser' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse' | 'select' | 'move';
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
  styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit {
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('display', { static: true }) displayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('canvasWrap', { static: true }) canvasWrapRef!: ElementRef<HTMLDivElement>;
  @ViewChild('importInput', { static: true }) importInputRef!: ElementRef<HTMLInputElement>;
  @ViewChild('projectInput', { static: true }) projectInputRef!: ElementRef<HTMLInputElement>;

  readonly tools: { id: Tool; label: string; key: string }[] = [
    { id: 'pen', label: 'Pen', key: 'P' },
    { id: 'eraser', label: 'Erase', key: 'E' },
    { id: 'fill', label: 'Fill', key: 'B' },
    { id: 'picker', label: 'Pick', key: 'I' },
    { id: 'line', label: 'Line', key: 'L' },
    { id: 'rect', label: 'Rect', key: 'R' },
    { id: 'ellipse', label: 'Oval', key: 'O' },
    { id: 'select', label: 'Select', key: 'S' },
    { id: 'move', label: 'Move', key: 'M' }
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
  activeTool: Tool = 'pen';
  primaryColor = '#222831';
  secondaryColor = '#f6f1de';
  brushSize = 1;
  palette = ['#222831', '#393e46', '#00adb5', '#eeeeee', '#f05454', '#f9d923', '#7dce82', '#5c7cfa'];

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
    return this.activeFrame.layers[this.activeLayerIndex] ?? this.activeFrame.layers[0];
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
    return this.frames.reduce((max, frame) => Math.max(max, frame.layers.length), 0);
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
    return this.selection ? `${this.selection.w} x ${this.selection.h} at ${this.selection.x}, ${this.selection.y}` : 'None';
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
    this.activeWorkspaceIndex = Math.min(this.activeWorkspaceIndex, this.workspaces.length - 1);
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
        Array.from({ length: frameCount }, (_, i) => this.loadImageUrl(`assets/idle-frames/idle_${String(i + 1).padStart(2, '0')}.png?v=${cacheBust}`))
      );

      this.width = targetWidth;
      this.height = targetHeight;
      this.importPaletteSize = 42;
      this.importDither = true;
      this.importSharpen = 0.45;
      this.importContrast = 1.12;
      this.importFit = 'contain';

      for (let i = 0; i < frameCount; i += 1) {
        const sampled = this.sampleImage(idleImages[i], targetWidth, targetHeight, {
          transparentWhite: true
        });
        sampled.palette.forEach(color => colors.set(color, (colors.get(color) ?? 0) + 1));
        frames.push({
          name: `Idle ${String(i + 1).padStart(2, '0')}`,
          duration: 140,
          visible: true,
          layers: [{
            name: 'Character',
            visible: true,
            opacity: 1,
            pixels: sampled.pixels
          }]
        });
      }

      this.frames = frames;
      this.activeFrameIndex = 0;
      this.previewFrameIndex = 0;
      this.activeLayerIndex = 0;
      this.palette = [
        '#ffe7d6', '#ffcdb8', '#ff6b6b', '#7a1e1e',
        '#1e1b2e', '#302d44', '#5e5873',
        '#ffffff', '#f8e9e6', '#b71c1c', '#8e0e0e', '#ff3b3b',
        '#ffd54f', '#d4ac0d', '#8b6f00', '#9e9e9e',
        '#fff1f1', '#ffb3b3', '#ff4646',
        ...[...colors.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color)
      ].filter((color, index, list) => list.indexOf(color) === index).slice(0, 32);
      this.primaryColor = '#1e1b2e';
      this.secondaryColor = '#ff4646';
      this.activeWorkspaceIndex = 0;
      this.workspaces[0] = this.captureWorkspace('Kitsune Idle Example', this.workspaces[0].id);
      this.refreshAllFrameThumbnails();
      this.render();
    } catch {
      this.render();
    }
  }

  private extractSpriteFromSheet(image: HTMLImageElement, rect: SourceRect): { canvas: HTMLCanvasElement; bounds: PixelBounds } {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.w);
    canvas.height = Math.round(rect.h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.removeWhiteBackground(imageData);
    ctx.putImageData(imageData, 0, 0);
    return {
      canvas,
      bounds: this.findLargestOpaqueBounds(imageData) ?? { x: 0, y: 0, w: canvas.width, h: canvas.height }
    };
  }

  private sampleAlignedSpriteFrame(sourceCanvas: HTMLCanvasElement, bounds: PixelBounds, width: number, height: number, scale: number): { pixels: Pixel[]; palette: string[] } {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    const drawWidth = Math.round(bounds.w * scale);
    const drawHeight = Math.round(bounds.h * scale);
    const drawX = Math.round((width - drawWidth) / 2);
    const drawY = Math.round(height - drawHeight - 7);
    ctx.drawImage(sourceCanvas, bounds.x, bounds.y, bounds.w, bounds.h, drawX, drawY, drawWidth, drawHeight);
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
            { x: point.x, y: point.y - 1 }
          ];
          for (const neighbor of neighbors) {
            if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= width || neighbor.y >= height) {
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
            area
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
      const source = frame.layers[this.activeLayerIndex] ?? this.createLayer(`Layer ${this.activeLayerIndex + 1}`);
      frame.layers.splice(this.activeLayerIndex + 1, 0, {
        name: `${source.name} copy`,
        visible: source.visible,
        opacity: source.opacity,
        pixels: [...source.pixels]
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
    this.frames.splice(this.activeFrameIndex + 1, 0, this.createFrame(`Frame ${this.frames.length + 1}`));
    this.activeFrameIndex += 1;
    this.activeLayerIndex = 0;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  duplicateFrame(): void {
    this.pushUndo();
    const copy = this.cloneFrame(this.activeFrame, `${this.activeFrame.name} copy`);
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
    this.activeLayerIndex = Math.min(this.activeLayerIndex, this.activeFrame.layers.length - 1);
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
    const point = this.eventToPixel(event);
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
      this.floodFill(point.x, point.y, this.activeLayer.pixels[this.index(point.x, point.y)], this.primaryColor);
    } else if (this.activeTool === 'select') {
      this.selection = { x: point.x, y: point.y, w: 1, h: 1, pixels: [] };
    } else if (this.activeTool === 'move' && this.selection) {
      this.previewPixels = [...this.activeLayer.pixels];
      this.moveStartSelection = { ...this.selection, pixels: [...this.selection.pixels] };
    }
    this.render();
  }

  onCanvasWrapPointerDown(event: PointerEvent): void {
    if (event.target === this.canvasWrapRef.nativeElement || event.button === 1) {
      this.beginPan(event);
    }
  }

  onCanvasWrapPointerMove(event: PointerEvent): void {
    if (!this.panState) {
      return;
    }
    const wrap = this.canvasWrapRef.nativeElement;
    wrap.scrollLeft = this.panState.scrollLeft - (event.clientX - this.panState.clientX);
    wrap.scrollTop = this.panState.scrollTop - (event.clientY - this.panState.clientY);
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
      startBottomHeight: this.bottomPanelHeight
    };
    this.isResizingPane = true;
  }

  resizePane(event: PointerEvent): void {
    if (!this.paneResizeState || this.paneResizeState.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - this.paneResizeState.clientX;
    if (this.paneResizeState.pane === 'left') {
      this.leftPanelWidth = this.clamp(this.paneResizeState.startLeftWidth + dx, 150, 360);
    } else if (this.paneResizeState.pane === 'right') {
      this.rightPanelWidth = this.clamp(this.paneResizeState.startRightWidth - dx, 240, 520);
    } else {
      const dy = event.clientY - this.paneResizeState.clientY;
      this.bottomPanelHeight = this.clamp(this.paneResizeState.startBottomHeight - dy, 120, 420);
    }
  }

  endPaneResize(event: PointerEvent): void {
    if (!this.paneResizeState || this.paneResizeState.pointerId !== event.pointerId) {
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
      this.drawLine(this.pointer.x, this.pointer.y, point.x, point.y, (x, y) => this.paint(x, y));
      this.pointer.x = point.x;
      this.pointer.y = point.y;
    } else if (this.activeTool === 'select') {
      this.selection = this.rectFromPoints(this.pointer.startX, this.pointer.startY, point.x, point.y);
    } else if (this.activeTool === 'move' && this.selection && this.previewPixels) {
      const dx = point.x - this.pointer.startX;
      const dy = point.y - this.pointer.startY;
      this.moveSelectionPreview(dx, dy);
    } else if (['line', 'rect', 'ellipse'].includes(this.activeTool)) {
      this.previewPixels = [...this.activeLayer.pixels];
      this.drawShape(this.previewPixels, this.pointer.startX, this.pointer.startY, point.x, point.y, this.activeTool);
    }
    this.render();
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.pointer) {
      return;
    }
    const point = this.eventToPixel(event) ?? { x: this.pointer.x, y: this.pointer.y };

    if (this.activeTool === 'line' || this.activeTool === 'rect' || this.activeTool === 'ellipse') {
      this.drawShape(this.activeLayer.pixels, this.pointer.startX, this.pointer.startY, point.x, point.y, this.activeTool);
      this.previewPixels = null;
    } else if (this.activeTool === 'select' && this.selection) {
      this.selection = this.normalizeSelection(this.selection);
      this.selection.pixels = this.copyPixels(this.selection);
    } else if (this.activeTool === 'move' && this.selection && this.previewPixels) {
      this.activeLayer.pixels = [...this.previewPixels];
      this.selection.pixels = this.copyPixels(this.selection);
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
    this.clipboard = { ...this.selection, pixels: this.copyPixels(this.selection) };
  }

  cutSelection(): void {
    if (!this.selection) {
      return;
    }
    this.pushUndo();
    this.copySelection();
    this.eachSelectionPixel(this.selection, (x, y) => this.setPixel(this.activeLayer.pixels, x, y, null));
    this.render();
  }

  pasteSelection(): void {
    if (!this.clipboard) {
      return;
    }
    this.pushUndo();
    const x = Math.min(this.width - this.clipboard.w, Math.max(0, this.selection?.x ?? 0));
    const y = Math.min(this.height - this.clipboard.h, Math.max(0, this.selection?.y ?? 0));
    this.selection = { ...this.clipboard, x, y, pixels: [...this.clipboard.pixels] };
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
    this.eachSelectionPixel(this.selection, (x, y) => this.setPixel(this.activeLayer.pixels, x, y, null));
    this.selection = {
      x: this.selection.x,
      y: this.selection.y,
      w: this.selection.h,
      h: this.selection.w,
      pixels: next
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
    this.eachSelectionPixel(target, (x, y) => this.setPixel(this.activeLayer.pixels, x, y, null));
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
      workspaces: this.workspaces.map(workspace => this.cloneWorkspace(workspace)),
      settings: {
        zoom: this.zoom,
        displayZoom: this.displayZoom,
        showGrid: this.showGrid,
        onionSkin: this.onionSkin,
        brushSize: this.brushSize,
        importResizeCanvas: this.importResizeCanvas,
        importLongSide: this.importLongSide,
        importFit: this.importFit,
        importPaletteSize: this.importPaletteSize,
        importDither: this.importDither,
        importSharpen: this.importSharpen,
        importContrast: this.importContrast
      }
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    const activeName = this.activeWorkspace.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'pixel-art';
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
    this.activeLayerIndex = Math.min(this.activeLayerIndex, this.activeFrame.layers.length - 1);
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
    if (this.isPlaying && !this.frames.some(item => item.visible)) {
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

  toggleCellVisibility(frameIndex: number, layerIndex: number, event?: Event): void {
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
    this.palette = [normalized, ...this.palette.filter(item => item.toLowerCase() !== normalized)].slice(0, 32);
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
    [this.primaryColor, this.secondaryColor] = [this.secondaryColor, this.primaryColor];
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
    const tool = this.tools.find(item => item.key.toLowerCase() === key);
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

  private captureWorkspace(name = this.activeWorkspace?.name ?? 'Workspace', id = this.activeWorkspace?.id ?? 1): WorkspaceState {
    return {
      id,
      name,
      width: this.width,
      height: this.height,
      frames: this.frames.map(frame => this.cloneFrame(frame, frame.name)),
      activeFrameIndex: this.activeFrameIndex,
      activeLayerIndex: this.activeLayerIndex,
      palette: [...this.palette],
      primaryColor: this.primaryColor,
      secondaryColor: this.secondaryColor
    };
  }

  private saveCurrentWorkspace(): void {
    if (!this.workspaces[this.activeWorkspaceIndex]) {
      return;
    }
    const current = this.workspaces[this.activeWorkspaceIndex];
    this.workspaces[this.activeWorkspaceIndex] = this.captureWorkspace(current.name, current.id);
  }

  private applyWorkspace(workspace: WorkspaceState): void {
    window.clearTimeout(this.animationTimer);
    this.isPlaying = false;
    this.width = workspace.width;
    this.height = workspace.height;
    this.frames = workspace.frames.map(frame => this.cloneFrame(frame, frame.name));
    this.activeFrameIndex = Math.min(workspace.activeFrameIndex, this.frames.length - 1);
    this.activeLayerIndex = Math.min(workspace.activeLayerIndex, this.activeFrame.layers.length - 1);
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
      secondaryColor: this.secondaryColor
    };
  }

  private loadProject(project: PixelArtProjectFile): void {
    if (project.app !== 'Pixel Studio' || project.version !== 1 || !Array.isArray(project.workspaces) || project.workspaces.length === 0) {
      throw new Error('Unsupported Pixel Studio project file.');
    }
    const workspaces = project.workspaces.map(workspace => this.normalizeWorkspace(workspace));
    this.workspaces = workspaces;
    this.activeWorkspaceIndex = this.clamp(project.activeWorkspaceIndex ?? 0, 0, workspaces.length - 1);
    this.workspaceIdSeed = Math.max(project.workspaceIdSeed ?? workspaces.length + 1, ...workspaces.map(workspace => workspace.id + 1));

    const settings = project.settings;
    if (settings) {
      this.zoom = this.clamp(settings.zoom ?? this.zoom, 6, 32);
      this.displayZoom = this.clamp(settings.displayZoom ?? this.displayZoom, 2, 12);
      this.showGrid = settings.showGrid ?? this.showGrid;
      this.onionSkin = settings.onionSkin ?? this.onionSkin;
      this.brushSize = this.clamp(settings.brushSize ?? this.brushSize, 1, 8);
      this.importResizeCanvas = settings.importResizeCanvas ?? this.importResizeCanvas;
      this.importLongSide = this.clamp(settings.importLongSide ?? this.importLongSide, 16, 128);
      this.importFit = settings.importFit ?? this.importFit;
      this.importPaletteSize = this.clamp(settings.importPaletteSize ?? this.importPaletteSize, 4, 64);
      this.importDither = settings.importDither ?? this.importDither;
      this.importSharpen = this.clamp(settings.importSharpen ?? this.importSharpen, 0, 1);
      this.importContrast = this.clamp(settings.importContrast ?? this.importContrast, 0.8, 1.4);
    }

    this.applyWorkspace(this.activeWorkspace);
  }

  private normalizeWorkspace(workspace: WorkspaceState): WorkspaceState {
    const width = this.clamp(Math.floor(workspace.width), 8, 128);
    const height = this.clamp(Math.floor(workspace.height), 8, 128);
    const pixelCount = width * height;
    const frames = (workspace.frames?.length ? workspace.frames : [this.createFrame('Frame 1')]).map((frame, frameIndex) => ({
      name: frame.name || `Frame ${frameIndex + 1}`,
      duration: this.clamp(Math.floor(frame.duration ?? 160), 40, 5000),
      visible: frame.visible ?? true,
      layers: (frame.layers?.length ? frame.layers : [this.createLayer('Layer 1')]).map((layer, layerIndex) => ({
        name: layer.name || `Layer ${layerIndex + 1}`,
        visible: layer.visible ?? true,
        opacity: this.clamp(layer.opacity ?? 1, 0, 1),
        pixels: this.normalizePixels(layer.pixels, pixelCount)
      }))
    }));
    const activeFrameIndex = this.clamp(workspace.activeFrameIndex ?? 0, 0, frames.length - 1);
    const activeLayerIndex = this.clamp(workspace.activeLayerIndex ?? 0, 0, frames[activeFrameIndex].layers.length - 1);
    return {
      id: workspace.id || this.workspaceIdSeed++,
      name: workspace.name || 'Imported Workspace',
      width,
      height,
      frames,
      activeFrameIndex,
      activeLayerIndex,
      palette: this.normalizePalette(workspace.palette),
      primaryColor: this.normalizeRequiredColor(workspace.primaryColor, '#222831'),
      secondaryColor: this.normalizeRequiredColor(workspace.secondaryColor, '#f6f1de')
    };
  }

  private cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
    return {
      ...workspace,
      frames: workspace.frames.map(frame => this.cloneFrame(frame, frame.name)),
      palette: [...workspace.palette]
    };
  }

  private normalizePixels(pixels: Pixel[] | undefined, pixelCount: number): Pixel[] {
    const normalized = new Array<Pixel>(pixelCount).fill(null);
    for (let i = 0; i < Math.min(pixelCount, pixels?.length ?? 0); i += 1) {
      normalized[i] = this.normalizeColor(pixels![i], null);
    }
    return normalized;
  }

  private normalizePalette(palette: string[] | undefined): string[] {
    const colors = (palette ?? [])
      .map(color => this.normalizeColor(color, null))
      .filter((color): color is string => Boolean(color));
    return (colors.length ? colors : ['#222831', '#393e46', '#00adb5', '#eeeeee']).slice(0, 64);
  }

  private normalizeColor(color: unknown, fallback: string | null): Pixel {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
  }

  private normalizeRequiredColor(color: unknown, fallback: string): string {
    return this.normalizeColor(color, fallback) ?? fallback;
  }

  private createFrame(name: string): Frame {
    return {
      name,
      duration: 160,
      visible: true,
      layers: [this.createLayer('Layer 1')]
    };
  }

  private createLayer(name: string): Layer {
    return {
      name,
      visible: true,
      opacity: 1,
      pixels: new Array<Pixel>(this.width * this.height).fill(null)
    };
  }

  private cloneFrame(frame: Frame, name: string): Frame {
    return {
      name,
      duration: frame.duration,
      visible: frame.visible,
      layers: frame.layers.map(layer => ({
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        pixels: [...layer.pixels]
      }))
    };
  }

  private eventToPixel(event: PointerEvent): { x: number; y: number } | null {
    const rect = this.stageRef.nativeElement.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / this.zoom);
    const y = Math.floor((event.clientY - rect.top) / this.zoom);
    if (!this.inside(x, y)) {
      return null;
    }
    return { x, y };
  }

  private paint(x: number, y: number): void {
    const radius = Math.max(1, this.brushSize);
    for (let oy = 0; oy < radius; oy += 1) {
      for (let ox = 0; ox < radius; ox += 1) {
        this.setPixel(this.activeLayer.pixels, x + ox, y + oy, this.activeTool === 'eraser' ? null : this.primaryColor);
      }
    }
  }

  private floodFill(x: number, y: number, target: Pixel, replacement: Pixel): void {
    if (target === replacement) {
      return;
    }
    const queue = [{ x, y }];
    while (queue.length) {
      const point = queue.shift()!;
      if (!this.inside(point.x, point.y) || this.activeLayer.pixels[this.index(point.x, point.y)] !== target) {
        continue;
      }
      this.setPixel(this.activeLayer.pixels, point.x, point.y, replacement);
      queue.push({ x: point.x + 1, y: point.y }, { x: point.x - 1, y: point.y }, { x: point.x, y: point.y + 1 }, { x: point.x, y: point.y - 1 });
    }
  }

  private drawShape(buffer: Pixel[], x0: number, y0: number, x1: number, y1: number, tool: Tool): void {
    if (tool === 'line') {
      this.drawLine(x0, y0, x1, y1, (x, y) => this.setPixel(buffer, x, y, this.primaryColor));
    } else if (tool === 'rect') {
      const rect = this.normalizeSelection(this.rectFromPoints(x0, y0, x1, y1));
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        this.setPixel(buffer, x, rect.y, this.primaryColor);
        this.setPixel(buffer, x, rect.y + rect.h - 1, this.primaryColor);
      }
      for (let y = rect.y; y < rect.y + rect.h; y += 1) {
        this.setPixel(buffer, rect.x, y, this.primaryColor);
        this.setPixel(buffer, rect.x + rect.w - 1, y, this.primaryColor);
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
            this.setPixel(buffer, x, y, this.primaryColor);
          }
        }
      }
    }
  }

  private drawLine(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
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
      scrollTop: wrap.scrollTop
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

    this.drawComposite(this.ctx, this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex, this.zoom, true);
    if (this.previewPixels) {
      this.drawPixels(this.ctx, this.previewPixels, this.zoom, this.activeLayer.opacity);
    }
    if (this.showGrid) {
      this.drawGrid();
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
    this.drawComposite(this.displayCtx, this.isPlaying ? this.previewFrameIndex : this.activeFrameIndex, this.displayZoom, true);
    if (this.previewPixels) {
      this.drawPixels(this.displayCtx, this.previewPixels, this.displayZoom, this.activeLayer.opacity);
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
    this.drawCheckerboardTo(ctx, Math.max(4, Math.floor(previewWidth / Math.max(this.width, this.height))));
    const scale = Math.max(1, Math.floor(Math.min(previewWidth / this.width, previewHeight / this.height)));
    const drawWidth = this.width * scale;
    const drawHeight = this.height * scale;
    const offsetX = Math.floor((previewWidth - drawWidth) / 2);
    const offsetY = Math.floor((previewHeight - drawHeight) / 2);
    ctx.save();
    ctx.translate(offsetX, offsetY);
    frame.layers.forEach(layer => {
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

  private drawComposite(ctx: CanvasRenderingContext2D, frameIndex: number, scale: number, skipActivePreview: boolean): void {
    const frame = this.frames[frameIndex];
    if (!frame || !frame.visible) {
      return;
    }
    frame.layers.forEach((layer, index) => {
      if (!layer.visible || (skipActivePreview && this.previewPixels && index === this.activeLayerIndex)) {
        return;
      }
      this.drawPixels(ctx, layer.pixels, scale, layer.opacity);
    });
  }

  private drawPixels(ctx: CanvasRenderingContext2D, pixels: Pixel[], scale: number, opacity: number): void {
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

  private drawCheckerboardTo(ctx: CanvasRenderingContext2D, cell: number): void {
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

  private drawSelection(): void {
    if (!this.selection) {
      return;
    }
    this.ctx.strokeStyle = '#111827';
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([5, 4]);
    this.ctx.strokeRect(this.selection.x * this.zoom + 1, this.selection.y * this.zoom + 1, this.selection.w * this.zoom - 2, this.selection.h * this.zoom - 2);
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

  private sampleImage(image: HTMLImageElement, width: number, height: number, options: SampleOptions = {}): { pixels: Pixel[]; palette: string[] } {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    const source = options.sourceRect ?? { x: 0, y: 0, w: image.width, h: image.height };
    const target = this.getImportTargetRect(source.w, source.h, width, height);
    ctx.drawImage(image, source.x, source.y, source.w, source.h, target.x, target.y, target.w, target.h);
    const imageData = ctx.getImageData(0, 0, width, height);
    if (options.transparentWhite) {
      this.removeWhiteBackground(imageData);
    }
    this.enhanceImageData(imageData, width, height);
    return this.imageDataToPixels(imageData, width, height);
  }

  private imageDataToPixels(imageData: ImageData, width: number, height: number): { pixels: Pixel[]; palette: string[] } {
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
        const nearest = this.nearestPaletteColor(data[i], data[i + 1], data[i + 2], palette);
        const color = this.rgbToHex(nearest[0], nearest[1], nearest[2]);
        pixels.push(color);
        counts.set(color, (counts.get(color) ?? 0) + 1);
        if (this.importDither) {
          this.spreadDitherError(data, width, height, x, y, [
            data[i] - nearest[0],
            data[i + 1] - nearest[1],
            data[i + 2] - nearest[2]
          ]);
        }
      }
    }
    return {
      pixels,
      palette: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 32).map(([color]) => color)
    };
  }

  private getImportTargetRect(sourceWidth: number, sourceHeight: number, width: number, height: number): { x: number; y: number; w: number; h: number } {
    if (this.importFit === 'stretch') {
      return { x: 0, y: 0, w: width, h: height };
    }
    const scale = this.importFit === 'cover'
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight);
    const w = sourceWidth * scale;
    const h = sourceHeight * scale;
    return {
      x: (width - w) / 2,
      y: (height - h) / 2,
      w,
      h
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
      const isBackdrop = imageData.data[dataIndex + 3] < 20 || (r > 238 && g > 238 && b > 238 && Math.max(r, g, b) - Math.min(r, g, b) < 16);
      if (!isBackdrop) {
        continue;
      }
      imageData.data[dataIndex + 3] = 0;
      queue.push(
        { x: point.x + 1, y: point.y },
        { x: point.x - 1, y: point.y },
        { x: point.x, y: point.y + 1 },
        { x: point.x, y: point.y - 1 }
      );
    }
  }

  private enhanceImageData(imageData: ImageData, width: number, height: number): void {
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
          const sharpened = source[i + channel] + this.importSharpen * (source[i + channel] - sum / count);
          imageData.data[i + channel] = this.clamp(Math.round((sharpened - 128) * this.importContrast + 128), 0, 255);
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
      .map(item => ({ rgb: item.rgb, cluster: 0 }));
    if (colors.length <= size) {
      return colors.map(item => item.rgb);
    }
    let centers = colors
      .filter((_, index) => index % Math.max(1, Math.floor(colors.length / size)) === 0)
      .slice(0, size)
      .map(item => [...item.rgb]);
    for (let iteration = 0; iteration < 8; iteration += 1) {
      colors = colors.map(color => ({ ...color, cluster: this.nearestPaletteIndex(color.rgb[0], color.rgb[1], color.rgb[2], centers) }));
      centers = centers.map((center, index) => {
        const group = colors.filter(color => color.cluster === index);
        if (!group.length) {
          return center;
        }
        return [0, 1, 2].map(channel => Math.round(group.reduce((sum, color) => sum + color.rgb[channel], 0) / group.length));
      });
    }
    return centers;
  }

  private nearestPaletteColor(r: number, g: number, b: number, palette: number[][]): number[] {
    return palette[this.nearestPaletteIndex(r, g, b, palette)];
  }

  private nearestPaletteIndex(r: number, g: number, b: number, palette: number[][]): number {
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

  private spreadDitherError(data: Float32Array, width: number, height: number, x: number, y: number, error: number[]): void {
    const targets = [
      { x: x + 1, y, factor: 7 / 16 },
      { x: x - 1, y: y + 1, factor: 3 / 16 },
      { x, y: y + 1, factor: 5 / 16 },
      { x: x + 1, y: y + 1, factor: 1 / 16 }
    ];
    for (const target of targets) {
      if (target.x < 0 || target.y < 0 || target.x >= width || target.y >= height) {
        continue;
      }
      const i = (target.y * width + target.x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        data[i + channel] = this.clamp(data[i + channel] + error[channel] * target.factor, 0, 255);
      }
    }
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b].map(value => this.clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
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
      x: this.clamp(this.moveStartSelection.x + dx, 0, this.width - this.moveStartSelection.w),
      y: this.clamp(this.moveStartSelection.y + dy, 0, this.height - this.moveStartSelection.h)
    };
    this.previewPixels = [...this.activeLayer.pixels];
    this.eachSelectionPixel(this.moveStartSelection, (x, y) => this.setPixel(this.previewPixels!, x, y, null));
    this.selection = moved;
    this.stampSelection(moved, this.previewPixels);
  }

  private stampSelection(selection: Selection, buffer = this.activeLayer.pixels): void {
    for (let y = 0; y < selection.h; y += 1) {
      for (let x = 0; x < selection.w; x += 1) {
        this.setPixel(buffer, selection.x + x, selection.y + y, selection.pixels[y * selection.w + x]);
      }
    }
  }

  private copyPixels(selection: Selection): Pixel[] {
    const pixels: Pixel[] = [];
    for (let y = 0; y < selection.h; y += 1) {
      for (let x = 0; x < selection.w; x += 1) {
        pixels.push(this.activeLayer.pixels[this.index(selection.x + x, selection.y + y)] ?? null);
      }
    }
    return pixels;
  }

  private eachSelectionPixel(selection: Selection, fn: (x: number, y: number) => void): void {
    for (let y = selection.y; y < selection.y + selection.h; y += 1) {
      for (let x = selection.x; x < selection.x + selection.w; x += 1) {
        fn(x, y);
      }
    }
  }

  private rectFromPoints(x0: number, y0: number, x1: number, y1: number): Selection {
    return this.normalizeSelection({
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      w: Math.abs(x1 - x0) + 1,
      h: Math.abs(y1 - y0) + 1,
      pixels: []
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
      h: this.clamp(selection.h, 1, this.height - y)
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
      secondaryColor: this.secondaryColor
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
    this.selection = null;
    this.previewPixels = null;
    this.refreshAllFrameThumbnails();
    this.render();
  }

  private playNextFrame(): void {
    if (!this.isPlaying) {
      return;
    }
    if (!this.frames.some(frame => frame.visible)) {
      this.isPlaying = false;
      return;
    }
    this.previewFrameIndex = this.findNextVisibleFrameIndex(this.previewFrameIndex);
    this.render();
    this.animationTimer = window.setTimeout(() => this.playNextFrame(), this.frames[this.previewFrameIndex].duration);
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
