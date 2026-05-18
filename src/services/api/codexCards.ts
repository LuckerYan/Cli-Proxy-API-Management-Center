import { apiClient } from './client';
import type {
  CodexCardDeleteResponse,
  CodexCardGenerateResponse,
  CodexCardImportResponse,
  CodexCardListResponse,
  CodexCardType,
} from '@/types';

export const codexCardsApi = {
  list: async (): Promise<CodexCardListResponse> => {
    const data = await apiClient.get<CodexCardListResponse>('/codex-cards');
    return {
      cards: Array.isArray(data?.cards) ? data.cards : [],
      summary: data?.summary || undefined,
    };
  },

  generate: async (count: number, type: CodexCardType): Promise<CodexCardGenerateResponse> => {
    const data = await apiClient.post<CodexCardGenerateResponse>('/codex-cards/generate', {
      count,
      type,
    });
    return data || {};
  },

  import: async (items: string[]): Promise<CodexCardImportResponse> => {
    const data = await apiClient.post<CodexCardImportResponse>('/codex-cards/import', {
      items,
    });
    return data || {};
  },

  delete: async (items: string[]): Promise<CodexCardDeleteResponse> => {
    const data = await apiClient.post<CodexCardDeleteResponse>('/codex-cards/delete', {
      items,
    });
    return data || {};
  },

  exportSelected: async (
    items: string[]
  ): Promise<{ blob: Blob; filename: string }> => {
    const response = await apiClient.requestRaw({
      url: '/codex-cards/export',
      method: 'POST',
      data: { items },
      responseType: 'blob',
    });
    const headers = (response.headers ?? {}) as Record<string, unknown>;
    const disposition = headers['content-disposition'] ?? headers['Content-Disposition'];
    const dispositionStr = typeof disposition === 'string' ? disposition : '';
    const match = dispositionStr.match(/filename="?([^";]+)"?/i);
    return {
      blob: response.data as Blob,
      filename: match ? match[1] : 'codex-cards.txt',
    };
  },
};
