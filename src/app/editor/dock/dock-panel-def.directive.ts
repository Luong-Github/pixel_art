import { Directive, Input, TemplateRef } from '@angular/core';
import { PanelId } from './dock.types';

/**
 * Marks an `<ng-template>` as the body of a dockable panel.
 * Usage: `<ng-template dockPanelDef="tools"> … </ng-template>`
 * Collected by EditorComponent via `@ViewChildren(DockPanelDefDirective)`.
 */
@Directive({
  selector: '[dockPanelDef]',
  standalone: true,
})
export class DockPanelDefDirective {
  @Input('dockPanelDef') id!: PanelId;

  constructor(public readonly template: TemplateRef<unknown>) {}
}
