/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        // Worker pool: limit concurrent fetchQuota calls so a large batch
        // doesn't fire N parallel HTTP requests and freeze the UI. The cap
        // is configurable via window.__CPA_QUOTA_REFRESH_CONCURRENCY
        // (defaults to 10, range 1-targets.length). Each worker writes its
        // result into the store as soon as it finishes so the UI updates
        // progressively rather than waiting for the whole batch.
        const concurrencyOverride =
          typeof window !== 'undefined'
            ? Number((window as { __CPA_QUOTA_REFRESH_CONCURRENCY?: number })
                .__CPA_QUOTA_REFRESH_CONCURRENCY)
            : NaN;
        const concurrency = Math.max(
          1,
          Math.min(
            Number.isFinite(concurrencyOverride) ? concurrencyOverride : 10,
            targets.length
          )
        );
        const results: LoadQuotaResult<TData>[] = new Array(targets.length);
        let cursor = 0;
        const runWorker = async () => {
          for (;;) {
            const idx = cursor++;
            if (idx >= targets.length) return;
            const file = targets[idx];
            try {
              const data = await config.fetchQuota(file, t);
              results[idx] = { name: file.name, status: 'success', data };
              if (requestId === requestIdRef.current) {
                setQuota((prev) => ({
                  ...prev,
                  [file.name]: config.buildSuccessState(data),
                }));
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              results[idx] = {
                name: file.name,
                status: 'error',
                error: message,
                errorStatus,
              };
              if (requestId === requestIdRef.current) {
                setQuota((prev) => ({
                  ...prev,
                  [file.name]: config.buildErrorState(message, errorStatus),
                }));
              }
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(concurrency, targets.length) }, () => runWorker())
        );

        if (requestId !== requestIdRef.current) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (!result) return;
            if (result.status === 'success') {
              nextState[result.name] = config.buildSuccessState(result.data as TData);
            } else {
              nextState[result.name] = config.buildErrorState(
                result.error || t('common.unknown_error'),
                result.errorStatus
              );
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
