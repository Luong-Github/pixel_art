import { computed, effect, Injectable, signal } from '@angular/core';
import { ApiError } from '../../core/api/api-client.service';
import { AuthService } from '../../core/auth/auth.service';
import { AiApiService } from './ai-api.service';
import { CloudProjectApiService, CloudQuota } from './cloud-project-api.service';
import { ProjectStoreService, StoredProject } from './project-store.service';

/** Per-project sync bookkeeping. Lives beside the projects, not inside them. */
interface SyncState {
  version: number;
  dirty: boolean;
  syncedAt: number;
}

export interface SyncConflict {
  id: string;
  name: string;
  localUpdatedAt: number;
  serverVersion: number;
}

const STATE_KEY = 'pixelart.sync.state';
/** Quiet period after the last local write. A drawing session must not become hundreds of uploads. */
const DEBOUNCE_MS = 20_000;

/**
 * Cloud sync that sits **on top of** the local store, never in front of it.
 *
 * Two invariants, neither of which is negotiable:
 *
 * 1. **The editor never waits for the network.** `ProjectStoreService` writes to
 *    IndexedDB first, always; this service reacts afterwards, in the background.
 * 2. **Nothing is ever silently overwritten.** Pixel art has no sensible merge —
 *    if two devices edited the same project, the only safe move is to keep both
 *    and let the author choose. Last-write-wins here means deleting someone's work.
 */
@Injectable({ providedIn: 'root' })
export class CloudSyncService {
  readonly quota = signal<CloudQuota | null>(null);
  readonly conflicts = signal<SyncConflict[]>([]);
  readonly syncing = signal(false);
  readonly lastError = signal<string | null>(null);

  /** True once the user is signed in and the API answered at least once. */
  readonly enabled = computed(() => this.auth.signedIn());

  private readonly state = new Map<string, SyncState>();
  private readonly pending = new Map<string, number>();
  private timer?: ReturnType<typeof setTimeout>;
  /** Ids the service itself is writing right now — their change events must not re-queue a push. */
  private readonly selfWrites = new Set<string>();
  private migratedForUser = false;

  constructor(
    private readonly store: ProjectStoreService,
    private readonly api: CloudProjectApiService,
    private readonly aiApi: AiApiService,
    private readonly auth: AuthService,
  ) {
    this.loadState();

    effect(() => {
      const change = this.store.lastChange();
      if (!change || !this.enabled()) return;
      if (this.selfWrites.has(change.id)) return;
      if (change.kind === 'delete') void this.pushDelete(change.id);
      else this.schedule(change.id);
    });

    // Guest -> login: everything drawn before signing in goes up, keeping its id
    // (create_project accepts a client-supplied uuid), so there is no reconcile step.
    effect(() => {
      if (this.enabled() && !this.migratedForUser) {
        this.migratedForUser = true;
        void this.migrateLocalProjects();
      }
      if (!this.enabled()) this.migratedForUser = false;
    });

    if (typeof window !== 'undefined') {
      // Coming back online is the moment the queue is worth draining.
      window.addEventListener('online', () => void this.flush());
    }
  }

  /** Push everything still marked dirty. Safe to call repeatedly. */
  async flush(): Promise<void> {
    if (!this.enabled() || this.syncing()) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    this.syncing.set(true);
    try {
      for (const id of [...this.pending.keys()]) {
        this.pending.delete(id);
        await this.push(id);
      }
      await this.refreshQuota();
    } finally {
      this.syncing.set(false);
    }
  }

  async refreshQuota(): Promise<void> {
    if (!this.enabled()) return;
    try {
      this.quota.set(await this.api.quota());
    } catch {
      // Quota is a mirror for the UI; the server enforces it regardless.
    }
  }

  dismissConflict(id: string): void {
    this.conflicts.update((list) => list.filter((c) => c.id !== id));
  }

  /**
   * Default conflict resolution: keep BOTH versions. The local edit moves to a new
   * project ("name + suffix"), and the server version takes the original id back.
   * Nobody's pixels are deleted by a machine.
   */
  async resolveConflictKeepBoth(id: string, copySuffix: string): Promise<void> {
    const local = await this.store.get(id);
    const conflict = this.conflicts().find((c) => c.id === id);
    this.dismissConflict(id);
    if (!local) return;

    // 1. Local edit survives as a new project — a normal put, so the ordinary
    //    sync path picks it up and creates it in the cloud under its new id.
    const copyId = crypto.randomUUID();
    await this.store.put({
      ...local,
      id: copyId,
      name: `${local.name}${copySuffix}`,
      updatedAt: Date.now(),
    });

    // 2. The original id goes back to what the server has.
    try {
      const detail = await this.api.get(id);
      if (detail.downloadUrl) {
        const data = await downloadProjectFile(detail.downloadUrl);
        this.selfWrites.add(id);
        try {
          await this.store.put({
            id,
            name: detail.project.name,
            createdAt: local.createdAt,
            updatedAt: Date.now(),
            thumbnail: local.thumbnail,
            data,
          });
        } finally {
          this.selfWrites.delete(id);
        }
      }
      this.state.set(id, {
        version: conflict?.serverVersion ?? detail.project.version,
        dirty: false,
        syncedAt: Date.now(),
      });
      this.saveState();
    } catch {
      // Server copy unreachable right now: the local copy above already preserved
      // the user's work, so the worst case is retrying the pull later.
    }
  }

  private async migrateLocalProjects(): Promise<void> {
    const metas = await this.store.list();
    for (const meta of metas) {
      if (!this.state.has(meta.id)) this.pending.set(meta.id, Date.now());
    }
    if (this.pending.size > 0) await this.flush();
    else await this.refreshQuota();
  }

  private schedule(id: string): void {
    this.pending.set(id, Date.now());
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), DEBOUNCE_MS);
  }

  private async push(id: string): Promise<void> {
    const project = await this.store.get(id);
    if (!project) return;

    const state = this.state.get(id) ?? { version: 0, dirty: true, syncedAt: 0 };

    try {
      if (state.version === 0) {
        try {
          await this.api.create(id, project.name);
          state.version = 1;
        } catch (error) {
          // Already in the cloud (synced from another device, or local sync state was
          // cleared). Adopt the server's version instead of failing forever.
          const remote = await this.api.get(id).catch(() => null);
          if (!remote) throw error;
          state.version = remote.project.version;
        }
      }

      const payload = await gzip(JSON.stringify(project.data));

      const ticket = await this.api.requestUpload(id, state.version, payload.byteLength);

      const uploaded = await fetch(ticket.uploadUrl, { method: 'PUT', body: payload });
      if (!uploaded.ok) throw new Error(`upload failed: ${uploaded.status}`);

      const version = await this.api.commit(id, {
        expectedVersion: state.version,
        blobPath: ticket.blobPath,
        blobBytes: payload.byteLength,
        workspaceCount: countWorkspaces(project),
        frameCount: countFrames(project),
        clientUpdatedAt: new Date(project.updatedAt).toISOString(),
      });

      this.state.set(id, { version, dirty: false, syncedAt: Date.now() });
      this.saveState();
      this.lastError.set(null);

      // E1: index the thumbnail so "find similar" can see this project. Strictly
      // best-effort — a missing embedder must never make a save look failed.
      if (project.thumbnail) {
        void this.aiApi.index(id, 0, project.thumbnail).catch(() => undefined);
      }
    } catch (error) {
      this.handleFailure(id, project, error);
    }
  }

  private handleFailure(id: string, project: StoredProject, error: unknown): void {
    // Stays dirty: the next flush retries. Losing the flag would lose the edit.
    this.state.set(id, {
      ...(this.state.get(id) ?? { version: 0, syncedAt: 0 }),
      dirty: true,
    } as SyncState);
    this.saveState();

    if (!(error instanceof ApiError)) {
      this.lastError.set('sync.offline');
      return;
    }

    if (error.code === 'version_conflict') {
      // The author decides. We surface it and stop — no merge, no overwrite.
      this.conflicts.update((list) => [
        ...list.filter((c) => c.id !== id),
        {
          id,
          name: project.name,
          localUpdatedAt: project.updatedAt,
          serverVersion: parseServerVersion(error.message),
        },
      ]);
      return;
    }

    this.lastError.set(
      error.code === 'quota_exceeded'
        ? 'sync.quotaExceeded'
        : error.code === 'blob_too_large'
          ? 'sync.tooLarge'
          : 'sync.failed',
    );
  }

  private async pushDelete(id: string): Promise<void> {
    try {
      await this.api.delete(id);
    } catch {
      // A delete that didn't reach the server leaves a row in the cloud trash;
      // harmless, and the next full sync reconciles it.
    }
    this.state.delete(id);
    this.saveState();
  }

  private loadState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (!raw) return;
      for (const [id, value] of Object.entries(JSON.parse(raw) as Record<string, SyncState>)) {
        this.state.set(id, value);
        if (value.dirty) this.pending.set(id, value.syncedAt);
      }
    } catch {
      // Corrupt state is not worth crashing over — worst case we re-upload once.
    }
  }

  private saveState(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(Object.fromEntries(this.state)));
    } catch {
      // Quota-full localStorage must not break drawing.
    }
  }
}

/**
 * gzip in the browser. A 64×64 × 10-frame project is ~800 KB of raw JSON and
 * ~50 KB gzipped — the difference between sync being cheap and being a bandwidth bill.
 */
async function gzip(text: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return bytes;

  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function countWorkspaces(project: StoredProject): number {
  const data = project.data as { workspaces?: unknown[] } | undefined;
  return data?.workspaces?.length ?? 1;
}

function countFrames(project: StoredProject): number {
  const data = project.data as { workspaces?: { frames?: unknown[] }[] } | undefined;
  return data?.workspaces?.reduce((total, w) => total + (w.frames?.length ?? 0), 0) || 1;
}

/** Fetch a project blob and gunzip it back into a PixelArtProjectFile. */
async function downloadProjectFile(url: string): Promise<unknown> {
  const blob = await (await fetch(url)).blob();
  if (typeof DecompressionStream === 'undefined') return JSON.parse(await blob.text());
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

/** The server reports "… (expected N, current M)"; M is what the UI needs. */
function parseServerVersion(message: string): number {
  return Number(/current (\d+)/.exec(message)?.[1] ?? 0);
}
