import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { codexCardsApi } from '@/services/api/codexCards';
import type {
  CodexCard,
  CodexCardSummary,
  CodexCardType,
} from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './CodexCardsPage.module.scss';

const PAGE_SIZE = 50;
type StatusFilter = 'all' | 'used' | 'unused';
type StatusKind = 'ok' | 'error' | '';

const cardRedeemedAtValue = (card: CodexCard | null | undefined): unknown => {
  if (!card) return '';
  return card.redeemed_at ?? card.redeemedAt ?? '';
};

const cardTypeLabel = (
  card: CodexCard | null | undefined
): { value: CodexCardType; label: string } => {
  if (!card) return { value: 'free', label: 'Free' };
  const raw = String(card.card_type ?? card.cardType ?? '').trim().toLowerCase();
  if (raw === 'plus') return { value: 'plus', label: 'Plus' };
  return { value: 'free', label: 'Free' };
};

const formatDate = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  const d = value instanceof Date ? value : new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
};

const localDateKey = (value: unknown): string => {
  if (!value) return '';
  const d = new Date(value as string | number);
  if (Number.isNaN(d.getTime())) return '';
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
};

const countRedeemedToday = (cards: CodexCard[]): number => {
  const todayKey = localDateKey(new Date());
  if (!todayKey) return 0;
  return cards.filter((card) => {
    if (String(card.status ?? '').trim().toLowerCase() !== 'redeemed') return false;
    return localDateKey(cardRedeemedAtValue(card)) === todayKey;
  }).length;
};

const extractCardCodeKeyParam = (value: string): string => {
  try {
    const parsed = new URL(value, window.location.origin);
    const key = parsed.searchParams.get('key');
    if (key && key.trim()) return key.trim();
  } catch {
    /* fallthrough to regex */
  }
  const match = String(value || '').match(/(?:^|[?&#])key=([^&#\s]+)/i);
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    } catch {
      return match[1].trim();
    }
  }
  return '';
};

const cardCodeInputCandidates = (trimmed: string): string[] => {
  const candidates = [trimmed];
  const markerIndex = trimmed.indexOf('---');
  if (markerIndex >= 0) {
    const suffix = trimmed.slice(markerIndex + 3).trim();
    if (suffix && suffix !== trimmed) candidates.unshift(suffix);
  }
  return candidates;
};

const extractCardCodeInput = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  for (const candidate of cardCodeInputCandidates(trimmed)) {
    const key = extractCardCodeKeyParam(candidate);
    if (key) return key;
  }
  return trimmed;
};

const extractCardCodeInputs = (text: string): string[] =>
  String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(extractCardCodeInput)
    .filter(Boolean);

type CardSearch = {
  raw: string;
  terms: string[];
  batch: boolean;
};

const parseCardSearch = (value: string): CardSearch => {
  const normalized = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const terms = normalized
    .split('\n')
    .map(extractCardCodeInput)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  return {
    raw: normalized.trim().toLowerCase(),
    terms,
    batch: normalized.indexOf('\n') >= 0,
  };
};

const cardSearchHaystack = (card: CodexCard): string => {
  const redeemedAt = cardRedeemedAtValue(card);
  return [
    card.code,
    card.status,
    card['source'],
    card.created_at,
    formatDate(card.created_at),
    redeemedAt,
    formatDate(redeemedAt),
    card['redeemed_file'],
    card['redeemed_auth_id'],
    card.note,
  ]
    .map((v) => String(v ?? ''))
    .join(' ')
    .toLowerCase();
};

const cardMatchesSearch = (card: CodexCard, search: CardSearch): boolean => {
  if (!search.raw && search.terms.length === 0) return true;
  const code = String(card.code ?? '').trim().toLowerCase();
  if (search.batch && search.terms.length > 0) {
    return search.terms.some((term) => code === term);
  }
  if (search.terms.length === 1 && code === search.terms[0]) return true;
  return cardSearchHaystack(card).includes(search.raw);
};

const cardMatchesStatus = (card: CodexCard, filter: StatusFilter): boolean => {
  if (filter === 'all') return true;
  const status = String(card.status ?? '').trim().toLowerCase();
  if (filter === 'used') return status !== 'unused';
  return status === 'unused';
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'codex-cards.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const buildPageNumbers = (current: number, total: number): (number | '…')[] => {
  if (total <= 7) {
    const arr: number[] = [];
    for (let i = 1; i <= total; i++) arr.push(i);
    return arr;
  }
  const pages: (number | '…')[] = [1];
  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);
  if (current <= 3) {
    start = 2;
    end = 4;
  }
  if (current >= total - 2) {
    start = total - 3;
    end = total - 1;
  }
  if (start > 2) pages.push('…');
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < total - 1) pages.push('…');
  pages.push(total);
  return pages;
};

const IconRefresh = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);
const IconExport = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 10 5 5 5-5" />
    <path d="M12 15V3" />
  </svg>
);
const IconTrash = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M6 6l1 14h10l1-14" />
    <path d="M10 11v5" />
    <path d="M14 11v5" />
  </svg>
);

type CopyableProps = {
  text: string;
  title: string;
  children?: React.ReactNode;
};

function CopyableCode({ text, title, children }: CopyableProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timerRef = useRef<number | null>(null);
  const handleClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    let ok = false;
    try {
      ok = await copyToClipboard(text);
    } catch {
      ok = false;
    }
    setState(ok ? 'copied' : 'failed');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setState('idle'), 1200);
  };
  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );
  return (
    <span
      className={`${styles.code} ${styles.copyable} ${
        state === 'copied' ? styles.copied : state === 'failed' ? styles.failed : ''
      }`}
      title={title}
      onClick={handleClick}
    >
      {children ?? text}
    </span>
  );
}

export function CodexCardsPage() {
  const { t } = useTranslation();

  const [cards, setCards] = useState<CodexCard[]>([]);
  const [summary, setSummary] = useState<CodexCardSummary | undefined>();
  const [listStatus, setListStatus] = useState<{ message: string; kind: StatusKind }>({
    message: '',
    kind: '',
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const [generateCount, setGenerateCount] = useState('1');
  const [generateType, setGenerateType] = useState<CodexCardType>('free');
  const [generating, setGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState<{
    message: string;
    kind: StatusKind;
  }>({ message: '', kind: '' });
  const [generateOutput, setGenerateOutput] = useState('');

  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<{
    message: string;
    kind: StatusKind;
  }>({ message: '', kind: '' });

  const loadCards = useCallback(async () => {
    setListStatus({ message: t('codex_cards.list_loading'), kind: '' });
    try {
      const data = await codexCardsApi.list();
      setCards(data.cards);
      setSummary(data.summary);
      setPage(1);
      setListStatus({ message: t('codex_cards.list_refreshed'), kind: 'ok' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setListStatus({ message, kind: 'error' });
    }
  }, [t]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const parsedSearch = useMemo(() => parseCardSearch(search), [search]);

  const filteredCards = useMemo(
    () =>
      cards.filter(
        (card) => cardMatchesSearch(card, parsedSearch) && cardMatchesStatus(card, statusFilter)
      ),
    [cards, parsedSearch, statusFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageCards = filteredCards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const allOnPageSelected =
    pageCards.length > 0 && pageCards.every((card) => selected.has(card.code));
  const someOnPageSelected =
    pageCards.some((card) => selected.has(card.code)) && !allOnPageSelected;
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  const togglePageSelect = (checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) pageCards.forEach((card) => next.add(card.code));
      else pageCards.forEach((card) => next.delete(card.code));
      return next;
    });
  };

  const toggleOne = (code: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleGenerate = async () => {
    const count = Math.max(1, Math.floor(Number(generateCount) || 1));
    setGenerating(true);
    setGenerateStatus({ message: t('codex_cards.generate_loading'), kind: '' });
    try {
      const data = await codexCardsApi.generate(count, generateType);
      const codes = data.codes ?? [];
      setGenerateOutput(codes.join('\n') || JSON.stringify(data, null, 2));
      setGenerateStatus({
        message: t('codex_cards.generate_success', { count: codes.length || count }),
        kind: 'ok',
      });
      await loadCards();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setGenerateStatus({ message, kind: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async () => {
    const items = extractCardCodeInputs(importText);
    if (items.length === 0) {
      setImportStatus({ message: t('codex_cards.import_empty'), kind: 'error' });
      return;
    }
    setImporting(true);
    setImportStatus({ message: t('codex_cards.import_loading'), kind: '' });
    try {
      const data = await codexCardsApi.import(items);
      const imported = data.imported ?? 0;
      const duplicates = data.duplicates?.length ?? 0;
      const failed = data.failed?.length ?? 0;
      setImportStatus({
        message: t('codex_cards.import_summary', {
          imported,
          duplicate: duplicates,
          fail: failed,
          total: items.length,
        }),
        kind: failed > 0 ? 'error' : 'ok',
      });
      setImportText('');
      await loadCards();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImportStatus({ message, kind: 'error' });
    } finally {
      setImporting(false);
    }
  };

  const handleExportSelected = async () => {
    const items = Array.from(selected);
    if (items.length === 0) {
      setListStatus({ message: t('codex_cards.export_empty'), kind: 'error' });
      return;
    }
    setListStatus({ message: t('codex_cards.export_loading'), kind: '' });
    try {
      const { blob, filename } = await codexCardsApi.exportSelected(items);
      saveBlob(blob, filename);
      setListStatus({
        message: t('codex_cards.export_success', { count: items.length }),
        kind: 'ok',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setListStatus({ message, kind: 'error' });
    }
  };

  const handleDeleteSelected = async () => {
    const items = Array.from(selected);
    if (items.length === 0) {
      setListStatus({ message: t('codex_cards.delete_empty'), kind: 'error' });
      return;
    }
    if (!window.confirm(t('codex_cards.delete_confirm', { count: items.length }))) return;
    setListStatus({ message: t('codex_cards.delete_loading'), kind: '' });
    try {
      const data = await codexCardsApi.delete(items);
      setListStatus({
        message: t('codex_cards.delete_success', { count: data.deleted ?? items.length }),
        kind: 'ok',
      });
      setSelected(new Set());
      await loadCards();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setListStatus({ message, kind: 'error' });
    }
  };

  const redeemedToday = useMemo(() => {
    const fromSummary =
      (summary as { redeemed_today?: number; today_redeemed?: number } | undefined)
        ?.redeemed_today ??
      (summary as { redeemed_today?: number; today_redeemed?: number } | undefined)
        ?.today_redeemed;
    if (typeof fromSummary === 'number') return fromSummary;
    return countRedeemedToday(cards);
  }, [summary, cards]);

  const totalCount = summary?.total ?? cards.length;
  const unusedCount =
    summary?.unredeemed ??
    (summary as { unused?: number } | undefined)?.unused ??
    cards.filter((c) => String(c.status ?? '').trim().toLowerCase() === 'unused').length;
  const redeemedCount =
    summary?.redeemed ??
    cards.filter((c) => String(c.status ?? '').trim().toLowerCase() === 'redeemed').length;

  const renderEmptyMessage = () => {
    if (parsedSearch.raw || parsedSearch.terms.length > 0) {
      return parsedSearch.batch
        ? t('codex_cards.empty_batch_search')
        : t('codex_cards.empty_search');
    }
    if (statusFilter !== 'all') return t('codex_cards.empty_filtered');
    return t('codex_cards.empty');
  };

  const pageNumbers = buildPageNumbers(safePage, totalPages);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('codex_cards.page_title')}</h1>
        <p className={styles.desc}>{t('codex_cards.page_desc')}</p>
      </header>

      <section className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statValue}>{totalCount}</div>
          <div className={styles.statLabel}>{t('codex_cards.stat_total')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{unusedCount}</div>
          <div className={styles.statLabel}>{t('codex_cards.stat_unused')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{redeemedCount}</div>
          <div className={styles.statLabel}>{t('codex_cards.stat_redeemed_total')}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statValue}>{redeemedToday}</div>
          <div className={styles.statLabel}>{t('codex_cards.stat_redeemed_today')}</div>
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>{t('codex_cards.section_generate')}</h2>
          <div className={`${styles.row} ${styles.generateFields}`}>
            <div className={styles.generateField}>
              <label className={styles.label} htmlFor="codexCardGenerateCount">
                {t('codex_cards.generate_count')}
              </label>
              <input
                className={styles.input}
                id="codexCardGenerateCount"
                type="number"
                min={1}
                step={1}
                value={generateCount}
                onChange={(e) =>
                  setGenerateCount(e.target.value.replace(/[^0-9]/g, '') || '')
                }
                disabled={generating}
              />
            </div>
            <div className={styles.generateField}>
              <label className={styles.label} htmlFor="codexCardGenerateType">
                {t('codex_cards.generate_type')}
              </label>
              <select
                className={`${styles.input} ${styles.generateType}`}
                id="codexCardGenerateType"
                value={generateType}
                onChange={(e) => setGenerateType(e.target.value as CodexCardType)}
                disabled={generating}
              >
                <option value="plus">Codex Plus</option>
                <option value="free">Codex Free</option>
              </select>
            </div>
          </div>
          <div className={styles.generateActions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => void handleGenerate()}
              disabled={generating}
            >
              {generating ? t('codex_cards.generating') : t('codex_cards.generate')}
            </button>
          </div>
          {generateStatus.message && (
            <div
              className={`${styles.statusLine} ${
                generateStatus.kind === 'ok'
                  ? styles.statusOk
                  : generateStatus.kind === 'error'
                    ? styles.statusError
                    : ''
              }`}
            >
              {generateStatus.message}
            </div>
          )}
          <pre className={styles.output}>{generateOutput || t('codex_cards.waiting_generate')}</pre>
        </section>

        <section className={styles.card}>
          <h2>{t('codex_cards.section_import')}</h2>
          <label className={styles.label} htmlFor="codexCardImportCodes">
            {t('codex_cards.import_label')}
          </label>
          <textarea
            className={styles.textarea}
            id="codexCardImportCodes"
            placeholder={t('codex_cards.import_placeholder')}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={importing}
          />
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => void handleImport()}
              disabled={importing}
            >
              {importing ? t('codex_cards.importing') : t('codex_cards.import')}
            </button>
            <a
              className={`${styles.button} ${styles.secondary}`}
              href="/codex-extract.html"
              target="_blank"
              rel="noopener"
            >
              {t('codex_cards.open_extraction_page')}
            </a>
          </div>
          {importStatus.message && (
            <div
              className={`${styles.statusLine} ${
                importStatus.kind === 'ok'
                  ? styles.statusOk
                  : importStatus.kind === 'error'
                    ? styles.statusError
                    : ''
              }`}
            >
              {importStatus.message}
            </div>
          )}
        </section>

        <section className={`${styles.card} ${styles.wide}`}>
          <div className={styles.listHead}>
            <div>
              <h2>{t('codex_cards.section_list')}</h2>
              <p className={styles.muted}>{t('codex_cards.section_list_desc')}</p>
            </div>
          </div>
          <div className={styles.bulkbar}>
            <div className={styles.searchBox}>
              <textarea
                className={`${styles.input} ${styles.searchTextarea}`}
                rows={1}
                placeholder={t('codex_cards.search_placeholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <span className={styles.selection}>
              {t('codex_cards.selected_count', { count: selected.size })}
            </span>
            <span className={styles.spacer} aria-hidden="true" />
            <div className={styles.filterSelect}>
              <select
                className={styles.input}
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  setPage(1);
                }}
                aria-label={t('codex_cards.filter_label')}
              >
                <option value="all">{t('codex_cards.filter_all')}</option>
                <option value="used">{t('codex_cards.filter_used')}</option>
                <option value="unused">{t('codex_cards.filter_unused')}</option>
              </select>
            </div>
            <div className={styles.bulkActions}>
              <button
                type="button"
                className={`${styles.button} ${styles.secondary} ${styles.iconOnly}`}
                title={t('codex_cards.refresh')}
                aria-label={t('codex_cards.refresh')}
                onClick={() => void loadCards()}
              >
                <IconRefresh />
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.secondary} ${styles.iconOnly}`}
                title={t('codex_cards.export_selected')}
                aria-label={t('codex_cards.export_selected')}
                disabled={selected.size === 0}
                onClick={() => void handleExportSelected()}
              >
                <IconExport />
              </button>
              <button
                type="button"
                className={`${styles.button} ${styles.danger} ${styles.iconOnly}`}
                title={t('codex_cards.delete_selected')}
                aria-label={t('codex_cards.delete_selected')}
                disabled={selected.size === 0}
                onClick={() => void handleDeleteSelected()}
              >
                <IconTrash />
              </button>
            </div>
          </div>
          {listStatus.message && (
            <div
              className={`${styles.statusLine} ${
                listStatus.kind === 'ok'
                  ? styles.statusOk
                  : listStatus.kind === 'error'
                    ? styles.statusError
                    : ''
              }`}
            >
              {listStatus.message}
            </div>
          )}
          <div className={styles.tableWrap}>
            {pageCards.length === 0 ? (
              <div className={styles.empty}>{renderEmptyMessage()}</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.colSelect}>
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        className={styles.checkbox}
                        checked={allOnPageSelected}
                        onChange={(e) => togglePageSelect(e.target.checked)}
                        aria-label={t('codex_cards.select_all')}
                      />
                    </th>
                    <th>{t('codex_cards.col_code')}</th>
                    <th>{t('codex_cards.col_type')}</th>
                    <th>{t('codex_cards.col_status')}</th>
                    <th className={styles.colTime}>{t('codex_cards.col_time')}</th>
                    <th className={styles.colFile}>{t('codex_cards.col_file')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageCards.map((card) => {
                    const typeInfo = cardTypeLabel(card);
                    const status = String(card.status ?? '').trim();
                    const redeemedFile = String(card['redeemed_file'] ?? '');
                    const redeemedAt = cardRedeemedAtValue(card);
                    return (
                      <tr key={card.code}>
                        <td className={styles.colSelect}>
                          <input
                            type="checkbox"
                            className={styles.checkbox}
                            checked={selected.has(card.code)}
                            onChange={() => toggleOne(card.code)}
                            aria-label={t('codex_cards.select_code', { code: card.code })}
                          />
                        </td>
                        <td>
                          <CopyableCode
                            text={card.code}
                            title={t('codex_cards.click_to_copy_code')}
                          />
                        </td>
                        <td>
                          <span className={`${styles.typePill} ${styles[`type_${typeInfo.value}`]}`}>
                            {typeInfo.label}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              styles[`status_${status.toLowerCase()}`] ?? ''
                            }`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className={styles.colTime}>
                          <div className={styles.timeStack}>
                            <div className={styles.timeRow}>
                              <span className={styles.timeTag}>{t('codex_cards.time_created')}</span>
                              <span className={styles.timeValue}>{formatDate(card.created_at)}</span>
                            </div>
                            <div
                              className={`${styles.timeRow} ${styles.timeRedeemed} ${
                                redeemedAt ? '' : styles.timeEmpty
                              }`}
                            >
                              <span className={styles.timeTag}>{t('codex_cards.time_redeemed')}</span>
                              <span className={styles.timeValue}>
                                {redeemedAt
                                  ? formatDate(redeemedAt)
                                  : t('codex_cards.status_unredeemed_short')}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className={styles.colFile}>
                          {redeemedFile ? (
                            <CopyableCode
                              text={redeemedFile}
                              title={t('codex_cards.click_to_copy_file')}
                            />
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={`${styles.pageButton}`}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
              >
                {t('codex_cards.page_prev')}
              </button>
              {pageNumbers.map((num, idx) =>
                num === '…' ? (
                  <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>
                    …
                  </span>
                ) : (
                  <button
                    key={num}
                    type="button"
                    className={`${styles.pageButton} ${
                      num === safePage ? styles.pageButtonActive : ''
                    }`}
                    onClick={() => setPage(num as number)}
                  >
                    {num}
                  </button>
                )
              )}
              <button
                type="button"
                className={styles.pageButton}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
              >
                {t('codex_cards.page_next')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
