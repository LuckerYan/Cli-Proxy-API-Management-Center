import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/stores';
import { codexCardsApi } from '@/services/api/codexCards';
import type { CodexCard, CodexCardSummary, CodexCardType } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import styles from './CodexCardsPage.module.scss';

const PAGE_SIZE = 50;

type StatusFilter = 'all' | 'redeemed' | 'unredeemed';

const labelOfCardType = (card: CodexCard): { value: CodexCardType; label: string } => {
  const raw = String(card.card_type ?? card.cardType ?? '').trim().toLowerCase();
  if (raw === 'plus') return { value: 'plus', label: 'Plus' };
  return { value: 'free', label: 'Free' };
};

const formatDate = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toLocaleString();
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const redeemedAtOf = (card: CodexCard): unknown =>
  card.redeemed_at ?? card.redeemedAt ?? null;

const cardIsRedeemed = (card: CodexCard): boolean => {
  if (card.redeemed === true) return true;
  const at = redeemedAtOf(card);
  if (at && String(at).trim() !== '' && String(at).trim() !== '0') return true;
  const status = String(card.status ?? '').trim().toLowerCase();
  return status === 'redeemed';
};

const cardMatchesStatus = (card: CodexCard, filter: StatusFilter): boolean => {
  if (filter === 'all') return true;
  const redeemed = cardIsRedeemed(card);
  return filter === 'redeemed' ? redeemed : !redeemed;
};

const cardMatchesSearch = (card: CodexCard, terms: string[]): boolean => {
  if (terms.length === 0) return true;
  const haystack = [
    card.code,
    card.redeemed_by,
    card.note,
    card.card_type,
    card.cardType,
    card.status,
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .filter(Boolean);
  return terms.every((term) => haystack.some((value) => value.includes(term)));
};

const parseSearch = (raw: string): string[] => {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'codex-cards.txt';
  document.body.appendChild(link);
  link.click();
  link.remove();
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

export function CodexCardsPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [cards, setCards] = useState<CodexCard[]>([]);
  const [summary, setSummary] = useState<CodexCardSummary | undefined>();
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const [generateCount, setGenerateCount] = useState('1');
  const [generateType, setGenerateType] = useState<CodexCardType>('free');
  const [generating, setGenerating] = useState(false);
  const [generateOutput, setGenerateOutput] = useState('');

  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const data = await codexCardsApi.list();
      setCards(data.cards);
      setSummary(data.summary);
      setPage(1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showNotification(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showNotification]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const searchTerms = useMemo(() => parseSearch(search), [search]);

  const filteredCards = useMemo(
    () =>
      cards.filter(
        (card) => cardMatchesSearch(card, searchTerms) && cardMatchesStatus(card, statusFilter)
      ),
    [cards, searchTerms, statusFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredCards.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageCards = filteredCards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(pageCards.map((c) => c.code)));
    else setSelected(new Set());
  };

  const toggleSelectOne = (code: string) => {
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
    try {
      const data = await codexCardsApi.generate(count, generateType);
      const codes = data.codes ?? [];
      setGenerateOutput(codes.join('\n'));
      showNotification(
        t('codex_cards.generate_success', { count: codes.length || count }),
        'success'
      );
      await loadCards();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleImport = async () => {
    const items = importText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) {
      showNotification(t('codex_cards.import_empty'), 'warning');
      return;
    }
    setImporting(true);
    try {
      const data = await codexCardsApi.import(items);
      const imported = data.imported ?? 0;
      const duplicates = data.duplicates?.length ?? 0;
      const failed = data.failed?.length ?? 0;
      showNotification(
        t('codex_cards.import_summary', {
          imported,
          duplicate: duplicates,
          fail: failed,
          total: items.length,
        }),
        failed > 0 ? 'warning' : 'success'
      );
      setImportText('');
      await loadCards();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleImportFromFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const text = await file.text();
    setImportText((prev) => (prev ? `${prev}\n${text}` : text));
  };

  const handleExportSelected = async () => {
    const items = Array.from(selected);
    if (items.length === 0) {
      showNotification(t('codex_cards.export_empty'), 'warning');
      return;
    }
    try {
      const { blob, filename } = await codexCardsApi.exportSelected(items);
      saveBlob(blob, filename);
      showNotification(t('codex_cards.export_success', { count: items.length }), 'success');
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleDeleteSelected = async () => {
    const items = Array.from(selected);
    if (items.length === 0) {
      showNotification(t('codex_cards.delete_empty'), 'warning');
      return;
    }
    if (!window.confirm(t('codex_cards.delete_confirm', { count: items.length }))) return;
    try {
      const data = await codexCardsApi.delete(items);
      showNotification(
        t('codex_cards.delete_success', { count: data.deleted ?? items.length }),
        'success'
      );
      setSelected(new Set());
      await loadCards();
    } catch (err) {
      showNotification(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleCopy = async (text: string) => {
    const ok = await copyToClipboard(text);
    showNotification(
      ok ? t('common.copied_to_clipboard') : t('common.copy_failed'),
      ok ? 'success' : 'error'
    );
  };

  const renderSummary = (label: string, value: number | undefined) => (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value ?? 0}</div>
    </div>
  );

  const pageNumbers = buildPageNumbers(safePage, totalPages);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>{t('codex_cards.page_title')}</h1>
        <p className={styles.desc}>{t('codex_cards.page_desc')}</p>
      </header>

      <section className={`${styles.card} ${styles.wide}`}>
        <h2>{t('codex_cards.section_overview')}</h2>
        <div className={styles.stats}>
          {renderSummary(t('codex_cards.stat_total'), summary?.total ?? cards.length)}
          {renderSummary(t('codex_cards.stat_redeemed'), summary?.redeemed)}
          {renderSummary(t('codex_cards.stat_unredeemed'), summary?.unredeemed)}
          {renderSummary(
            t('codex_cards.stat_plus_total'),
            summary?.plus_total
          )}
        </div>
      </section>

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>{t('codex_cards.section_generate')}</h2>
          <p className={styles.muted}>{t('codex_cards.section_generate_desc')}</p>
          <div className={styles.generateFields}>
            <div className={styles.generateField}>
              <label className={styles.label}>{t('codex_cards.generate_count')}</label>
              <input
                className={styles.input}
                type="number"
                min={1}
                value={generateCount}
                onChange={(e) => setGenerateCount(e.target.value.replace(/[^0-9]/g, ''))}
                disabled={generating}
              />
            </div>
            <div className={styles.generateField}>
              <label className={styles.label}>{t('codex_cards.generate_type')}</label>
              <select
                className={styles.input}
                value={generateType}
                onChange={(e) => setGenerateType(e.target.value as CodexCardType)}
                disabled={generating}
              >
                <option value="free">Free</option>
                <option value="plus">Plus</option>
              </select>
            </div>
            <div className={styles.generateField}>
              <label className={styles.label}>&nbsp;</label>
              <Button onClick={() => void handleGenerate()} disabled={generating}>
                {generating ? t('codex_cards.generating') : t('codex_cards.generate')}
              </Button>
            </div>
          </div>
          {generateOutput && (
            <>
              <label className={styles.label}>{t('codex_cards.generate_output')}</label>
              <textarea
                className={styles.textarea}
                readOnly
                value={generateOutput}
                onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
              />
              <div className={styles.actions}>
                <Button variant="secondary" onClick={() => void handleCopy(generateOutput)}>
                  {t('codex_cards.copy_output')}
                </Button>
              </div>
            </>
          )}
        </section>

        <section className={styles.card}>
          <h2>{t('codex_cards.section_import')}</h2>
          <p className={styles.muted}>{t('codex_cards.section_import_desc')}</p>
          <label className={styles.label}>{t('codex_cards.import_input')}</label>
          <textarea
            className={styles.textarea}
            placeholder={t('codex_cards.import_placeholder')}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            disabled={importing}
          />
          <div className={styles.actions}>
            <Button onClick={() => void handleImport()} disabled={importing}>
              {importing ? t('codex_cards.importing') : t('codex_cards.import')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
            >
              {t('codex_cards.import_from_file')}
            </Button>
            <input
              type="file"
              accept=".txt,.csv,text/plain"
              ref={importInputRef}
              onChange={(e) => void handleImportFromFile(e)}
              hidden
            />
          </div>
        </section>
      </div>

      <section className={`${styles.card} ${styles.wide}`}>
        <h2>{t('codex_cards.section_list')}</h2>
        <div className={styles.listControls}>
          <input
            className={styles.input}
            placeholder={t('codex_cards.search_placeholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
          <select
            className={styles.input}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter);
              setPage(1);
            }}
          >
            <option value="all">{t('codex_cards.filter_all')}</option>
            <option value="unredeemed">{t('codex_cards.filter_unredeemed')}</option>
            <option value="redeemed">{t('codex_cards.filter_redeemed')}</option>
          </select>
          <Button variant="secondary" onClick={() => void loadCards()} disabled={loading}>
            {loading ? t('common.loading') : t('codex_cards.refresh')}
          </Button>
          <div className={styles.spacer} />
          <span className={styles.selection}>
            {t('codex_cards.selected_count', { count: selected.size })}
          </span>
          <Button
            variant="secondary"
            onClick={() => void handleExportSelected()}
            disabled={selected.size === 0}
          >
            {t('codex_cards.export_selected')}
          </Button>
          <Button
            variant="danger"
            onClick={() => void handleDeleteSelected()}
            disabled={selected.size === 0}
          >
            {t('codex_cards.delete_selected')}
          </Button>
        </div>

        {pageCards.length === 0 ? (
          <div className={styles.empty}>
            {search || statusFilter !== 'all'
              ? t('codex_cards.empty_filtered')
              : t('codex_cards.empty')}
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={
                        pageCards.length > 0 &&
                        pageCards.every((c) => selected.has(c.code))
                      }
                      onChange={(e) => toggleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th>{t('codex_cards.col_code')}</th>
                  <th>{t('codex_cards.col_type')}</th>
                  <th>{t('codex_cards.col_status')}</th>
                  <th>{t('codex_cards.col_time')}</th>
                  <th>{t('codex_cards.col_note')}</th>
                </tr>
              </thead>
              <tbody>
                {pageCards.map((card) => {
                  const typeInfo = labelOfCardType(card);
                  const redeemed = cardIsRedeemed(card);
                  return (
                    <tr key={card.code}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(card.code)}
                          onChange={() => toggleSelectOne(card.code)}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.codeButton}
                          onClick={() => void handleCopy(card.code)}
                          title={t('common.copy_to_clipboard')}
                        >
                          {card.code}
                        </button>
                      </td>
                      <td>
                        <span
                          className={`${styles.typeBadge} ${
                            typeInfo.value === 'plus' ? styles.typePlus : styles.typeFree
                          }`}
                        >
                          {typeInfo.label}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${
                            redeemed ? styles.statusRedeemed : styles.statusUnredeemed
                          }`}
                        >
                          {redeemed
                            ? t('codex_cards.status_redeemed')
                            : t('codex_cards.status_unredeemed')}
                        </span>
                      </td>
                      <td>
                        <div className={styles.timeStack}>
                          <div>
                            <span className={styles.timeTag}>
                              {t('codex_cards.time_created')}
                            </span>
                            <span>{formatDate(card.created_at) || '-'}</span>
                          </div>
                          <div className={!redeemed ? styles.timeEmpty : ''}>
                            <span className={styles.timeTag}>
                              {t('codex_cards.time_redeemed')}
                            </span>
                            <span>
                              {redeemed
                                ? formatDate(redeemedAtOf(card))
                                : t('codex_cards.status_unredeemed')}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>{card.note ?? card.redeemed_by ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
            >
              {t('codex_cards.page_prev')}
            </Button>
            {pageNumbers.map((num, idx) =>
              num === '…' ? (
                <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>
                  …
                </span>
              ) : (
                <Button
                  key={num}
                  variant={num === safePage ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setPage(num as number)}
                >
                  {num}
                </Button>
              )
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              {t('codex_cards.page_next')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
