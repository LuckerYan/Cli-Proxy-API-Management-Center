import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import {
  codexEffectivePlan,
  isAuthFileBanned,
  isCodexExtracted,
} from '@/features/authFiles/constants';
import styles from './CodexAccountStatsPanel.module.scss';

type CodexAccountStatsPanelProps = {
  files: AuthFileItem[];
};

type Bucket = {
  total: number;
  plus: number;
  free: number;
};

const emptyBucket = (): Bucket => ({ total: 0, plus: 0, free: 0 });

const isCodexFile = (file: AuthFileItem): boolean =>
  String(file.type ?? file.provider ?? '')
    .trim()
    .toLowerCase() === 'codex';

export function CodexAccountStatsPanel({ files }: CodexAccountStatsPanelProps) {
  const { t } = useTranslation();

  const buckets = useMemo(() => {
    const totalBucket = emptyBucket();
    const normalBucket = emptyBucket();
    const bannedBucket = emptyBucket();
    const unextractedBucket = emptyBucket();
    const extractedBucket = emptyBucket();

    for (const file of files) {
      if (!isCodexFile(file)) continue;
      const plan = codexEffectivePlan(file);
      const banned = isAuthFileBanned(file);
      const extracted = isCodexExtracted(file);

      totalBucket.total++;
      totalBucket[plan]++;

      if (banned) {
        bannedBucket.total++;
        bannedBucket[plan]++;
      } else {
        normalBucket.total++;
        normalBucket[plan]++;
      }

      if (extracted) {
        extractedBucket.total++;
        extractedBucket[plan]++;
      } else if (!banned) {
        unextractedBucket.total++;
        unextractedBucket[plan]++;
      }
    }

    return {
      total: totalBucket,
      normal: normalBucket,
      banned: bannedBucket,
      unextracted: unextractedBucket,
      extracted: extractedBucket,
    };
  }, [files]);

  if (buckets.total.total === 0) return null;

  const renderChip = (label: string, value: number, variant: 'plus' | 'free') => (
    <span className={`${styles.chip} ${styles[variant]}`}>
      <span>{label}</span>
      <span className={styles.chipValue} data-zero={value === 0 ? '1' : undefined}>
        {value}
      </span>
    </span>
  );

  const renderStat = (
    variant: 'total' | 'normal' | 'banned' | 'unextracted' | 'extracted',
    bucket: Bucket
  ) => (
    <div className={`${styles.stat} ${styles[variant]}`}>
      <div className={styles.statHead}>
        <span className={styles.statLabel}>{t(`auth_files.codex_stats_${variant}`)}</span>
        <span className={styles.statValue}>{bucket.total}</span>
      </div>
      <div className={styles.statBreakdown}>
        {renderChip('Plus', bucket.plus, 'plus')}
        {renderChip('Free', bucket.free, 'free')}
      </div>
    </div>
  );

  return (
    <div className={styles.panel} role="region" aria-label={t('auth_files.codex_stats_title')}>
      <div className={styles.title}>{t('auth_files.codex_stats_title')}</div>
      {renderStat('total', buckets.total)}
      {renderStat('normal', buckets.normal)}
      {renderStat('banned', buckets.banned)}
      {renderStat('unextracted', buckets.unextracted)}
      {renderStat('extracted', buckets.extracted)}
    </div>
  );
}
