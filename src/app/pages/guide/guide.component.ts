import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, Inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '../../i18n/translate.pipe';

interface Shortcut {
  keys: string;
  action: string;
}

@Component({
  selector: 'app-guide',
  standalone: true,
  imports: [CommonModule, RouterLink, TranslatePipe],
  templateUrl: './guide.component.html',
  styleUrl: './guide.component.scss',
})
export class GuideComponent {
  constructor(@Inject(DOCUMENT) private doc: Document) {}

  /** Scroll to a section without triggering router navigation/scroll reset. */
  jumpTo(event: Event, id: string): void {
    event.preventDefault();
    this.doc.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Table-of-contents entries (anchor id + label). */
  readonly toc = [
    { id: 'start', labelKey: 'guide.toc.start' },
    { id: 'interface', labelKey: 'guide.toc.interface' },
    { id: 'tools', labelKey: 'guide.toc.tools' },
    { id: 'drawing', labelKey: 'guide.toc.drawing' },
    { id: 'generate', labelKey: 'guide.toc.generate' },
    { id: 'color', labelKey: 'guide.toc.color' },
    { id: 'layers', labelKey: 'guide.toc.layers' },
    { id: 'animation', labelKey: 'guide.toc.animation' },
    { id: 'import', labelKey: 'guide.toc.import' },
    { id: 'tilemap', labelKey: 'guide.toc.tilemap' },
    { id: 'export', labelKey: 'guide.toc.export' },
    { id: 'projects', labelKey: 'guide.toc.projects' },
    { id: 'shortcuts', labelKey: 'guide.toc.shortcuts' },
  ];

  readonly tools = [
    { key: 'P', nameKey: 'guide.tool.pen.name', descKey: 'guide.tool.pen.desc' },
    { key: 'E', nameKey: 'guide.tool.eraser.name', descKey: 'guide.tool.eraser.desc' },
    { key: 'B', nameKey: 'guide.tool.fill.name', descKey: 'guide.tool.fill.desc' },
    { key: 'D', nameKey: 'guide.tool.gradient.name', descKey: 'guide.tool.gradient.desc' },
    { key: 'A', nameKey: 'guide.tool.shade.name', descKey: 'guide.tool.shade.desc' },
    { key: 'K', nameKey: 'guide.tool.spray.name', descKey: 'guide.tool.spray.desc' },
    { key: 'I', nameKey: 'guide.tool.picker.name', descKey: 'guide.tool.picker.desc' },
    { key: 'L', nameKey: 'guide.tool.line.name', descKey: 'guide.tool.line.desc' },
    { key: 'R', nameKey: 'guide.tool.rectangle.name', descKey: 'guide.tool.rectangle.desc' },
    { key: 'O', nameKey: 'guide.tool.ellipse.name', descKey: 'guide.tool.ellipse.desc' },
    { key: 'S', nameKey: 'guide.tool.select.name', descKey: 'guide.tool.select.desc' },
    { key: 'W', nameKey: 'guide.tool.wand.name', descKey: 'guide.tool.wand.desc' },
    { key: 'Q', nameKey: 'guide.tool.lasso.name', descKey: 'guide.tool.lasso.desc' },
    { key: 'M', nameKey: 'guide.tool.move.name', descKey: 'guide.tool.move.desc' },
    { key: 'T', nameKey: 'guide.tool.transform.name', descKey: 'guide.tool.transform.desc' },
  ];

  readonly shortcuts: { keys: string; actionKey: string }[] = [
    { keys: 'Ctrl + K', actionKey: 'guide.shortcut.commandPalette' },
    { keys: 'P E B D A K I L R O S W Q M T', actionKey: 'guide.shortcut.pickTool' },
    { keys: 'Shift / Alt + Wand·Lasso', actionKey: 'guide.shortcut.addSubtract' },
    { keys: 'T then drag handles', actionKey: 'guide.shortcut.transform' },
    { keys: 'Enter / Esc', actionKey: 'guide.shortcut.commitCancel' },
    { keys: 'Space (hold)', actionKey: 'guide.shortcut.pan' },
    { keys: 'Ctrl + Z', actionKey: 'guide.shortcut.undo' },
    { keys: 'Ctrl + Y / Ctrl + Shift + Z', actionKey: 'guide.shortcut.redo' },
    { keys: 'Ctrl + C / X / V', actionKey: 'guide.shortcut.copyCutPaste' },
    { keys: 'Ctrl + J / Ctrl + Shift + J', actionKey: 'guide.shortcut.selectionToLayer' },
    { keys: 'Delete', actionKey: 'guide.shortcut.cutSelection' },
    { keys: '← ↑ → ↓', actionKey: 'guide.shortcut.nudge' },
    { keys: 'Enter', actionKey: 'guide.shortcut.playPause' },
    { keys: ', / .', actionKey: 'guide.shortcut.prevNextFrame' },
    { keys: 'X', actionKey: 'guide.shortcut.swapColors' },
    { keys: 'G', actionKey: 'guide.shortcut.toggleGrid' },
    { keys: 'Shift + M', actionKey: 'guide.shortcut.toggleSymmetry' },
    { keys: 'Shift + H / Shift + V', actionKey: 'guide.shortcut.flip' },
    { keys: '[ / ]', actionKey: 'guide.shortcut.brushSize' },
    { keys: '+ / −', actionKey: 'guide.shortcut.zoomInOut' },
    { keys: 'Ctrl + scroll', actionKey: 'guide.shortcut.zoomCanvas' },
  ];
}
