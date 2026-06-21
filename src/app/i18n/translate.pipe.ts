import { Pipe, PipeTransform } from '@angular/core';
import { LocaleService } from './locale.service';

/**
 * `{{ 'menu.file' | t }}` — impure so it re-evaluates when the language signal
 * changes. Lookups are O(1) dictionary hits, cheap enough for an impure pipe.
 */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  constructor(private locale: LocaleService) {}

  transform(key: string, params?: Record<string, string | number>): string {
    return this.locale.t(key, params);
  }
}
