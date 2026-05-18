import { useEffect, useRef, useState } from 'react';
import styles from './CodexExtractApp.module.scss';

type ExtractFormat = 'cpa' | 'sub';

type FailureGroup = {
  message?: string;
  codes?: string[];
};

type ExtractSummary = {
  status?: string;
  requested?: number;
  success?: number;
  failed?: number;
  format?: ExtractFormat | string;
  failure_groups?: FailureGroup[];
  failureGroups?: FailureGroup[];
};

const FORMAT_LABEL: Record<ExtractFormat, string> = {
  cpa: 'CPA ZIP',
  sub: 'SUB JSON',
};

const EXTRACT_CONCURRENCY = 10;

const cardCodeInputCandidates = (trimmed: string): string[] => {
  const candidates = [trimmed];
  const markerIndex = trimmed.indexOf('---');
  if (markerIndex >= 0) {
    const suffix = trimmed.slice(markerIndex + 3).trim();
    if (suffix && suffix !== trimmed) candidates.unshift(suffix);
  }
  return candidates;
};

const extractCardCodeKeyParam = (value: string): string => {
  try {
    const parsed = new URL(value, window.location.origin);
    const key = parsed.searchParams.get('key');
    if (key && key.trim()) return key.trim();
  } catch {
    /* fallthrough */
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

const extractCardCodeInput = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  for (const candidate of cardCodeInputCandidates(trimmed)) {
    const key = extractCardCodeKeyParam(candidate);
    if (key) return key;
  }
  return trimmed;
};

const filenameFromDisposition = (value: string): string => {
  if (!value) return '';
  const match = value.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : '';
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'codex-auth-file.zip';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const blobFromBase64 = (encoded: string, contentType?: string): Blob => {
  const binary = atob(String(encoded || ''));
  const chunkSize = 8192;
  const chunks: BlobPart[] = [];
  for (let offset = 0; offset < binary.length; offset += chunkSize) {
    const slice = binary.slice(offset, offset + chunkSize);
    const bytes = new Uint8Array(slice.length);
    for (let i = 0; i < slice.length; i++) bytes[i] = slice.charCodeAt(i);
    chunks.push(bytes.buffer.slice(0));
  }
  return new Blob(chunks, { type: contentType || 'application/octet-stream' });
};

const defaultDownloadName = (format: ExtractFormat, count: number): string => {
  if (format === 'sub') return 'sub2api-account.json';
  return count > 1 ? 'codex-auth-files.zip' : 'codex-auth-file.zip';
};

const parseExtractSummaryHeader = (resp: Response): ExtractSummary | null => {
  const encoded = resp.headers.get('x-codex-extract-summary') || '';
  if (!encoded) return null;
  try {
    const binary = atob(encoded);
    let text = '';
    if (typeof TextDecoder !== 'undefined') {
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      text = new TextDecoder('utf-8').decode(bytes);
    } else {
      text = decodeURIComponent(escape(binary));
    }
    return JSON.parse(text) as ExtractSummary;
  } catch {
    return null;
  }
};

const fallbackSummary = (codes: string[], format: ExtractFormat): ExtractSummary => ({
  status: 'ok',
  requested: codes.length,
  success: codes.length,
  failed: 0,
  format,
  failure_groups: [],
});

const readError = async (resp: Response): Promise<{ error?: string; summary?: ExtractSummary }> => {
  const type = resp.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try {
      return await resp.json();
    } catch {
      /* fallthrough */
    }
  }
  try {
    return { error: await resp.text() };
  } catch {
    return { error: '' };
  }
};

type ProgressVariant = '' | 'busy' | 'success' | 'error';
type ProgressState = {
  value: number;
  stage: string;
  variant: ProgressVariant;
  visible: boolean;
};

const initialProgress: ProgressState = {
  value: 0,
  stage: '等待提取开始',
  variant: '',
  visible: false,
};

const Brand = () => (
  <div className={styles.brand}>
    <span className={styles.logo} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 3 8l9 13 9-13-9-5Z" />
        <path d="M12 7v10" />
        <path d="M7.5 9.5h9" />
        <path d="m8 14 4 3 4-3" />
      </svg>
    </span>
    <span className={styles.brandName}>CODEX EXTRACT</span>
  </div>
);

const Chip = ({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) => (
  <span className={styles.chip}>
    {icon}
    {children}
  </span>
);

export function CodexExtractApp() {
  const [input, setInput] = useState('');
  const [format, setFormat] = useState<ExtractFormat>('cpa');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(initialProgress);
  const [modal, setModal] = useState<{
    open: boolean;
    summary: ExtractSummary | null;
    formatLabel: string;
    message: string;
    phase: 'enter' | 'open' | 'closing';
  }>({ open: false, summary: null, formatLabel: '', message: '', phase: 'enter' });

  const progressTimerRef = useRef<number | null>(null);
  const progressResetTimerRef = useRef<number | null>(null);
  const progressTargetRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stopProgressTimers = () => {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (progressResetTimerRef.current) {
      window.clearTimeout(progressResetTimerRef.current);
      progressResetTimerRef.current = null;
    }
  };

  const hideProgress = () => {
    stopProgressTimers();
    progressTargetRef.current = 0;
    setProgress(initialProgress);
  };

  useEffect(() => () => stopProgressTimers(), []);

  const startProgress = (total: number, formatLabel: string, concurrency: number) => {
    stopProgressTimers();
    progressTargetRef.current = total > 6 ? 82 : 88;
    const concurrencyText = concurrency > 1 ? ` · 并发 ${concurrency}` : '';
    const stage =
      total > 1
        ? `验活中 · ${total} 项${concurrencyText} · 准备 ${formatLabel}…`
        : `验活中${concurrencyText} · 准备 ${formatLabel}…`;
    setProgress({ value: 8, stage, variant: 'busy', visible: true });
    progressTimerRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (!prev.visible || prev.variant !== 'busy') return prev;
        if (prev.value >= progressTargetRef.current) return prev;
        let step = prev.value < 30 ? 6 : prev.value < 70 ? 3 : 1;
        if (total > 3 && prev.value < 58) step += 1;
        const next = Math.min(progressTargetRef.current, prev.value + step);
        return { ...prev, value: next };
      });
    }, 170);
  };

  const completeProgress = (formatLabel: string) => {
    stopProgressTimers();
    setProgress({ value: 100, stage: `${formatLabel} 已完成`, variant: 'success', visible: true });
    progressResetTimerRef.current = window.setTimeout(hideProgress, 900);
  };

  const failProgress = (message: string) => {
    stopProgressTimers();
    setProgress({ value: 100, stage: message || '提取失败', variant: 'error', visible: true });
    progressResetTimerRef.current = window.setTimeout(hideProgress, 1400);
  };

  const getCardCodes = (): string[] =>
    input
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(extractCardCodeInput)
      .filter(Boolean);

  const openModal = (summary: ExtractSummary | null, formatLabel: string, message = '') => {
    setModal({ open: true, summary, formatLabel, message, phase: 'enter' });
    // 下一帧切换到 open，触发动画
    requestAnimationFrame(() => {
      setModal((prev) => (prev.open ? { ...prev, phase: 'open' } : prev));
    });
  };

  const closeModal = () => {
    setModal((prev) => (prev.open ? { ...prev, phase: 'closing' } : prev));
    window.setTimeout(() => {
      setModal({ open: false, summary: null, formatLabel: '', message: '', phase: 'enter' });
    }, 240);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const extract = async () => {
    const codes = getCardCodes();
    const formatLabel = FORMAT_LABEL[format];
    if (codes.length === 0) {
      openModal(
        { status: 'failed', requested: 0, success: 0, failed: 0, format, failure_groups: [] },
        formatLabel,
        '请先输入卡密或提取链接'
      );
      textareaRef.current?.focus();
      return;
    }
    setBusy(true);
    startProgress(codes.length, formatLabel, EXTRACT_CONCURRENCY);
    try {
      const resp = await fetch('/v0/codex-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: codes, format, concurrency: EXTRACT_CONCURRENCY }),
      });
      if (!resp.ok) {
        const err = await readError(resp);
        const httpErr = new Error(err.error || '提取失败') as Error & {
          summary?: ExtractSummary;
        };
        httpErr.summary = err.summary;
        throw httpErr;
      }
      const respType = resp.headers.get('content-type') || '';
      const disposition = resp.headers.get('content-disposition') || '';
      let blob: Blob;
      let filename: string;
      let summary: ExtractSummary;
      if (respType.includes('application/json') && !disposition) {
        const payload = (await resp.json()) as {
          download_base64?: string;
          content_type?: string;
          download_filename?: string;
          summary?: ExtractSummary;
          error?: string;
        };
        if (!payload.download_base64) throw new Error(payload.error || '提取失败');
        blob = blobFromBase64(payload.download_base64, payload.content_type);
        filename = payload.download_filename || defaultDownloadName(format, codes.length);
        summary = payload.summary || fallbackSummary(codes, format);
      } else {
        blob = await resp.blob();
        filename = filenameFromDisposition(disposition) || defaultDownloadName(format, codes.length);
        summary = parseExtractSummaryHeader(resp) || fallbackSummary(codes, format);
      }
      downloadBlob(blob, filename);
      completeProgress(formatLabel);
      hideProgress();
      openModal(summary, formatLabel);
      if (!summary.failed) setInput('');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const summary: ExtractSummary =
        (err as { summary?: ExtractSummary }).summary || {
          status: 'failed',
          requested: codes.length,
          success: 0,
          failed: 0,
          format,
          failure_groups: [],
        };
      hideProgress();
      failProgress(message);
      openModal(summary, formatLabel, message);
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void extract();
  };

  const resolveResultTitle = (summary: ExtractSummary | null): string => {
    if (!summary) return '提取失败';
    const status = String(summary.status || '').toLowerCase();
    const success = Number(summary.success || 0);
    const failed = Number(summary.failed || 0);
    if (status === 'partial') return '提取部分成功';
    if (status === 'failed') return '提取失败';
    return failed > 0 ? (success > 0 ? '提取部分成功' : '提取失败') : '提取成功';
  };

  const resolveResultMessage = (
    summary: ExtractSummary | null,
    formatLabel: string,
    extra: string
  ): string => {
    if (extra && extra.trim()) return extra.trim();
    if (!summary) return '提取失败。';
    const success = Number(summary.success || 0);
    const failed = Number(summary.failed || 0);
    if (failed > 0 && success > 0) {
      return `已为成功的卡密导出 ${formatLabel}；失败卡密已按错误原因分组显示。`;
    }
    if (failed > 0) {
      return '本次没有可导出的卡密；失败卡密已按错误原因分组显示。';
    }
    return `全部卡密提取成功，${formatLabel} 已开始下载。`;
  };

  const summary = modal.summary;
  const failureGroups: FailureGroup[] = summary
    ? Array.isArray(summary.failure_groups)
      ? summary.failure_groups
      : Array.isArray(summary.failureGroups)
        ? summary.failureGroups
        : []
    : [];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Brand />
        <div className={styles.pill}>
          <span className={styles.dot} />
          <span>服务在线</span>
        </div>
      </header>
      <main className={styles.center}>
        <section className={styles.panel}>
          <div className={styles.hero}>
            <div className={styles.kicker}>Codex Auth File</div>
            <h1 className={styles.title}>
              输入卡密，<span className={styles.hl}>一键提取</span>
            </h1>
            <p className={styles.desc}>
              支持粘贴卡密或邮箱---keycode 链接，系统验活通过后可导出 CPA ZIP 或 SUB JSON。
            </p>
            <div className={styles.metaRow}>
              <Chip
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
                  </svg>
                }
              >
                验活后下发
              </Chip>
              <Chip
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="m7 10 5 5 5-5" />
                    <path d="M12 15V3" />
                  </svg>
                }
              >
                CPA ZIP
              </Chip>
              <Chip
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 7h16" />
                    <path d="M4 12h16" />
                    <path d="M4 17h16" />
                  </svg>
                }
              >
                SUB JSON
              </Chip>
              <Chip
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                }
              >
                批量支持
              </Chip>
            </div>
          </div>
          <div className={styles.form}>
            <div className={styles.labelRow}>
              <label htmlFor="cardCode">卡密 / 提取链接</label>
            </div>
            <div className={styles.inputRow}>
              <textarea
                id="cardCode"
                ref={textareaRef}
                autoComplete="one-time-code"
                spellCheck={false}
                rows={3}
                placeholder={'user@example.com---https://mail.lucker.cc.cd/keycode?email=user@example.com&key=et_xxxxxxxxxxxxxxxxxxxxx\nCDX-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <div className={styles.formatPanel}>
                <div className={styles.formatHeading}>
                  <span>提取格式转换</span>
                  <small>点击提取后按选中格式下载</small>
                </div>
                <div className={styles.formatOptions} role="radiogroup" aria-label="提取格式">
                  {(['cpa', 'sub'] as ExtractFormat[]).map((value) => (
                    <label
                      key={value}
                      className={`${styles.formatCard} ${format === value ? styles.formatCardActive : ''}`}
                    >
                      <input
                        type="radio"
                        name="extractFormat"
                        value={value}
                        checked={format === value}
                        onChange={() => setFormat(value)}
                      />
                      <span className={styles.formatName}>{value === 'cpa' ? 'CPA 格式' : 'SUB 格式'}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className={styles.button}
                onClick={() => void extract()}
                disabled={busy}
                aria-busy={busy}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m7 10 5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
                <span>{busy ? '提取中…' : '提取'}</span>
              </button>
            </div>
            <div className={styles.note}>
              每行输入一张卡密或一个邮箱---keycode 链接；CPA 会合并为 ZIP，SUB 会导出单个 JSON。
            </div>
          </div>
        </section>
      </main>
      {progress.visible && (
        <div
          className={`${styles.progressShell} ${
            progress.variant === 'success'
              ? styles.progressSuccess
              : progress.variant === 'error'
                ? styles.progressError
                : ''
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          <div className={styles.progressMeta}>
            <span className={styles.progressStage}>{progress.stage}</span>
            <span className={styles.progressPercent}>{Math.round(progress.value)}%</span>
          </div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label="提取进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress.value)}
          >
            <div className={styles.progressFill} style={{ width: `${progress.value}%` }} />
          </div>
        </div>
      )}
      {modal.open && (
        <div
          className={`${styles.resultModal} ${
            modal.phase === 'open' ? styles.resultModalOpen : modal.phase === 'closing' ? styles.resultModalClosing : ''
          }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="resultTitle"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className={styles.resultCard}>
            <div className={styles.resultTitle}>
              <span id="resultTitle">{resolveResultTitle(summary)}</span>
              <button type="button" className={styles.resultClose} onClick={closeModal} aria-label="关闭">
                ×
              </button>
            </div>
            <div className={styles.resultCounts}>
              <div className={`${styles.resultCount} ${styles.resultCountSuccess}`}>
                <span>成功个数</span>
                <strong>{Number(summary?.success ?? 0)}</strong>
              </div>
              <div className={`${styles.resultCount} ${styles.resultCountFailed}`}>
                <span>失败个数</span>
                <strong>{Number(summary?.failed ?? 0)}</strong>
              </div>
            </div>
            <p className={styles.resultHelp}>
              {resolveResultMessage(summary, modal.formatLabel, modal.message)}
            </p>
            {failureGroups.map((group, idx) => {
              const codes = Array.isArray(group.codes) ? group.codes : [];
              if (codes.length === 0) return null;
              return (
                <div key={idx} className={styles.failureGroup}>
                  <div className={styles.failureGroupTitle}>
                    {(group.message || '提取失败') + `（${codes.length} 个）`}
                  </div>
                  <ul className={styles.failureCodeList}>
                    {codes.map((code, codeIdx) => (
                      <li key={`${idx}-${codeIdx}`}>{code}</li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <footer className={styles.footer}>
        <span className={styles.footerLeft}>© CODEX EXTRACT</span>
        <span className={styles.footerRight}>Codex Auth Pipeline</span>
      </footer>
    </div>
  );
}
