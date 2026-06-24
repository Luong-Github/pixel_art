import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'loading';

export interface Toast {
  id: number;
  kind: ToastKind;
  /** Already-translated text to display. */
  message: string;
  /** When true, never auto-dismisses (errors and loading are sticky by default). */
  sticky: boolean;
}

/**
 * Non-blocking toast notifications. `toasts` is a signal so the host re-renders
 * instantly. Success/info auto-dismiss; errors and loading stay until dismissed
 * or updated. Mounted once via ToastHostComponent in AppComponent.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  readonly toasts = signal<Toast[]>([]);

  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly MAX = 4;
  /** Auto-dismiss duration per kind (ms). 0 = sticky. */
  private readonly duration: Record<ToastKind, number> = {
    success: 3000,
    info: 5000,
    error: 0,
    loading: 0,
  };

  success(message: string, opts?: { sticky?: boolean }): number {
    return this.push('success', message, opts);
  }
  error(message: string, opts?: { sticky?: boolean }): number {
    return this.push('error', message, { sticky: true, ...opts });
  }
  info(message: string, opts?: { sticky?: boolean }): number {
    return this.push('info', message, opts);
  }
  /** A sticky spinner toast; convert it with update(id, {...}) when done. */
  loading(message: string): number {
    return this.push('loading', message, { sticky: true });
  }

  /** Patch an existing toast (e.g. loading → success) and re-arm its timer. */
  update(id: number, patch: Partial<Pick<Toast, 'kind' | 'message' | 'sticky'>>): void {
    const list = this.toasts();
    const i = list.findIndex((t) => t.id === id);
    if (i < 0) return;
    const next = { ...list[i], ...patch };
    // When converting away from a sticky kind without an explicit sticky flag,
    // let the new kind's default duration decide.
    if (patch.kind && patch.sticky === undefined) next.sticky = this.duration[patch.kind] === 0;
    const copy = [...list];
    copy[i] = next;
    this.toasts.set(copy);
    this.arm(next);
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  /** Pause auto-dismiss while the user hovers the toast. */
  pause(id: number): void {
    this.clearTimer(id);
  }
  resume(id: number): void {
    const t = this.toasts().find((x) => x.id === id);
    if (t) this.arm(t);
  }

  private push(kind: ToastKind, message: string, opts?: { sticky?: boolean }): number {
    const id = (this.seq += 1);
    const sticky = opts?.sticky ?? this.duration[kind] === 0;
    const toast: Toast = { id, kind, message, sticky };
    // Keep the updater pure: collect evicted ids, clear their timers afterwards.
    const evicted: number[] = [];
    this.toasts.update((list) => {
      const next = [...list, toast];
      // Cap the stack: drop the oldest non-sticky toast when over the limit.
      while (next.length > this.MAX) {
        const idx = next.findIndex((t) => !t.sticky);
        if (idx < 0) break;
        evicted.push(next[idx].id);
        next.splice(idx, 1);
      }
      return next;
    });
    evicted.forEach((eid) => this.clearTimer(eid));
    this.arm(toast);
    return id;
  }

  private arm(toast: Toast): void {
    this.clearTimer(toast.id);
    if (toast.sticky) return;
    const ms = this.duration[toast.kind] || 3000;
    this.timers.set(toast.id, setTimeout(() => this.dismiss(toast.id), ms));
  }

  private clearTimer(id: number): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }
}
