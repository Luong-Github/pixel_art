import { Injectable } from '@angular/core';
import { ApiClientService } from '../../core/api/api-client.service';

export interface CloudProject {
  id: string;
  name: string;
  version: number;
  blobBytes: number;
  workspaceCount: number;
  frameCount: number;
  updatedAt: string;
  clientUpdatedAt: string | null;
}

export interface CloudProjectDetail {
  project: CloudProject;
  downloadUrl: string | null;
}

export interface UploadTicket {
  uploadUrl: string;
  blobPath: string;
  nextVersion: number;
}

export interface CloudQuota {
  tier: 'free' | 'pro';
  maxProjects: number | null;
  maxTotalBytes: number | null;
  maxBlobBytes: number | null;
  usedProjects: number;
  usedBytes: number;
}

/**
 * Thin REST wrapper over `/projects` and `/quota`. One method per endpoint and
 * nothing else — the sync policy (when to push, what to do on conflict) lives in
 * `CloudSyncService`, not here.
 */
@Injectable({ providedIn: 'root' })
export class CloudProjectApiService {
  constructor(private readonly api: ApiClientService) {}

  list(): Promise<CloudProject[]> {
    return this.api.get<CloudProject[]>('/projects');
  }

  get(id: string): Promise<CloudProjectDetail> {
    return this.api.get<CloudProjectDetail>(`/projects/${id}`);
  }

  /** Passing the local id keeps a guest project's identity when it first reaches the cloud. */
  create(id: string, name: string): Promise<string> {
    return this.api.post<string>('/projects', { id, name });
  }

  /** Ask for permission to write. Returns where to PUT — the bytes never go through the API. */
  requestUpload(id: string, expectedVersion: number, sizeBytes: number): Promise<UploadTicket> {
    return this.api.put<UploadTicket>(`/projects/${id}`, { expectedVersion, sizeBytes });
  }

  commit(
    id: string,
    body: {
      expectedVersion: number;
      blobPath: string;
      blobBytes: number;
      workspaceCount: number;
      frameCount: number;
      clientUpdatedAt: string;
    },
  ): Promise<number> {
    return this.api.post<number>(`/projects/${id}/commit`, body);
  }

  delete(id: string): Promise<void> {
    return this.api.delete<void>(`/projects/${id}`);
  }

  quota(): Promise<CloudQuota> {
    return this.api.get<CloudQuota>('/quota');
  }
}
