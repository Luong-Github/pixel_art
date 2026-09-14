import { Injectable } from '@angular/core';
import { ApiClientService } from '../../core/api/api-client.service';

export interface GeneratedSprite {
  /** data:image/png;base64,... — ready for an <img> or the Convert flow. */
  png: string;
  creditCost: number | null;
  provider: string;
}

export interface SimilarAsset {
  projectId: string;
  name: string;
  frameIndex: number;
  distance: number;
}

/**
 * Thin REST wrapper over `/ai/*` and the training-consent flag. Like the other
 * API services: one method per endpoint, no policy here.
 */
@Injectable({ providedIn: 'root' })
export class AiApiService {
  constructor(private readonly api: ApiClientService) {}

  /** Fire-and-forget indexing of a project thumbnail after a successful sync. */
  index(projectId: string, frameIndex: number, pngDataUrl: string): Promise<void> {
    return this.api.post<void>('/ai/index', { projectId, frameIndex, png: pngDataUrl });
  }

  /** Text -> pixel-art sprite (E2). Server gates the quota; 402 means out of runs. */
  generate(prompt: string, width: number, height: number): Promise<GeneratedSprite> {
    return this.api.post<GeneratedSprite>('/ai/generate', { prompt, width, height });
  }

  similar(pngDataUrl: string, limit = 8): Promise<SimilarAsset[]> {
    return this.api.post<SimilarAsset[]>('/ai/similar', { png: pngDataUrl, limit });
  }

  getTrainingOptIn(): Promise<{ enabled: boolean }> {
    return this.api.get<{ enabled: boolean }>('/me/training-opt-in');
  }

  setTrainingOptIn(enabled: boolean): Promise<void> {
    return this.api.put<void>('/me/training-opt-in', { enabled });
  }
}
