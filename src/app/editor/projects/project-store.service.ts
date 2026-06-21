import { Injectable } from '@angular/core';

/** Lightweight project record (no pixel payload) — fast to list. */
export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Small PNG data URL preview of the active frame. */
  thumbnail: string;
}

/** Full record = meta + the serialized PixelArtProjectFile. */
export interface StoredProject extends ProjectMeta {
  data: unknown;
}

/**
 * Local project library backed by IndexedDB. Meta and pixel data live in
 * separate object stores so `list()` stays cheap (no pixel arrays loaded).
 *
 * The API (list/get/put/delete) is deliberately backend-shaped: swapping this
 * for a REST/Supabase implementation later only means re-implementing four
 * async methods — callers don't change.
 */
@Injectable({ providedIn: 'root' })
export class ProjectStoreService {
  private readonly DB = 'pixelart.projects';
  private readonly VERSION = 1;
  private readonly META = 'meta';
  private readonly DATA = 'data';
  private dbPromise?: Promise<IDBDatabase>;

  private get available(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB, this.VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.META)) {
          db.createObjectStore(this.META, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(this.DATA)) {
          db.createObjectStore(this.DATA, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  private tx<T>(
    stores: string[],
    mode: IDBTransactionMode,
    run: (tx: IDBTransaction) => IDBRequest<T>,
  ): Promise<T> {
    return this.open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const tx = db.transaction(stores, mode);
          const req = run(tx);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }),
    );
  }

  /** Project metas, newest first. Returns [] when storage is unavailable. */
  async list(): Promise<ProjectMeta[]> {
    if (!this.available) return [];
    const all = await this.tx<ProjectMeta[]>([this.META], 'readonly', (tx) =>
      tx.objectStore(this.META).getAll(),
    );
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredProject | undefined> {
    if (!this.available) return undefined;
    const [meta, payload] = await Promise.all([
      this.tx<ProjectMeta | undefined>([this.META], 'readonly', (tx) =>
        tx.objectStore(this.META).get(id),
      ),
      this.tx<{ id: string; data: unknown } | undefined>(
        [this.DATA],
        'readonly',
        (tx) => tx.objectStore(this.DATA).get(id),
      ),
    ]);
    if (!meta || !payload) return undefined;
    return { ...meta, data: payload.data };
  }

  /** Insert or update a project (meta + data) atomically. */
  async put(project: StoredProject): Promise<void> {
    if (!this.available) throw new Error('IndexedDB unavailable');
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      thumbnail: project.thumbnail,
    };
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.META, this.DATA], 'readwrite');
      tx.objectStore(this.META).put(meta);
      tx.objectStore(this.DATA).put({ id: project.id, data: project.data });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async delete(id: string): Promise<void> {
    if (!this.available) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([this.META, this.DATA], 'readwrite');
      tx.objectStore(this.META).delete(id);
      tx.objectStore(this.DATA).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
