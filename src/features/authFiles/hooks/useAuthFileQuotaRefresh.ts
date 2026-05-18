import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
} from '@/components/quota';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';

type QuotaState = { status?: string } | undefined;
type QuotaUpdater = (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
type QuotaConfig = {
  i18nPrefix: string;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  buildLoadingState: () => unknown;
  buildSuccessState: (data: unknown) => unknown;
  buildErrorState: (message: string, status?: number) => unknown;
};

const getQuotaConfig = (type: QuotaProviderType): QuotaConfig => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG as unknown as QuotaConfig;
  if (type === 'claude') return CLAUDE_CONFIG as unknown as QuotaConfig;
  if (type === 'codex') return CODEX_CONFIG as unknown as QuotaConfig;
  if (type === 'kimi') return KIMI_CONFIG as unknown as QuotaConfig;
  return GEMINI_CLI_CONFIG as unknown as QuotaConfig;
};

export function useAuthFileQuotaRefresh(file: AuthFileItem, quotaType: QuotaProviderType) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.setAntigravityQuota as unknown as QuotaUpdater;
    if (quotaType === 'claude') return state.setClaudeQuota as unknown as QuotaUpdater;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as QuotaUpdater;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as QuotaUpdater;
    return state.setGeminiCliQuota as unknown as QuotaUpdater;
  });

  const refresh = useCallback(
    async (options: { disableControls?: boolean } = {}) => {
      const { disableControls = false } = options;
      if (disableControls) return;
      if (isRuntimeOnlyAuthFile(file)) return;
      if (file.disabled) return;
      if (quota?.status === 'loading') return;

      const config = getQuotaConfig(quotaType);
      updateQuotaState((prev) => ({ ...prev, [file.name]: config.buildLoadingState() }));

      try {
        const data = await config.fetchQuota(file, t);
        updateQuotaState((prev) => ({ ...prev, [file.name]: config.buildSuccessState(data) }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        updateQuotaState((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [file, quota?.status, quotaType, showNotification, t, updateQuotaState]
  );

  return { refresh, status: quota?.status };
}
