import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Wordmark } from '../shared/ui/Brand';
import { KIND_LABELS, isTextless, type DocumentRecord } from '../shared/documents';
import { DocumentError } from '../documents/detect';

export type Status =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string; detail?: string }
  | { kind: 'error'; name: string; message: string; hint?: string }
  | { kind: 'password'; name: string; wrong: boolean };

interface Props {
  status: Status;
  docs: DocumentRecord[] | null;
  onFile: (file: File) => void;
  onOpen: (doc: DocumentRecord) => void;
  onRemove: (doc: DocumentRecord) => void;
  onUndoRemove: () => void;
  removed: DocumentRecord | null;
  onPassword: (password: string) => void;
  onDismiss: () => void;
}

export const ACCEPT =
  '.pdf,.epub,.docx,.txt,.text,.md,.markdown,.html,.htm,.xhtml,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown,text/html';

export function App(props: Props) {
  const { status, docs, onFile } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [filter, setFilter] = useState('');

  // Drop a file anywhere on the page.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    addEventListener('dragenter', enter);
    addEventListener('dragover', over);
    addEventListener('dragleave', leave);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragenter', enter);
      removeEventListener('dragover', over);
      removeEventListener('dragleave', leave);
      removeEventListener('drop', drop);
    };
  }, [onFile]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!docs || !q) return docs;
    return docs.filter((d) => `${d.title} ${d.author ?? ''} ${d.fileName}`.toLowerCase().includes(q));
  }, [docs, filter]);

  const busy = status.kind === 'loading';

  return (
    <div class="lb">
      <header class="lb-top">
        <Wordmark size={28} />
        <a class="lb-top__link" href="../options/index.html#reading">
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          Settings
        </a>
      </header>

      <main class="lb-main" id="main">
        <section class="lb-open" aria-labelledby="open-h">
          <h1 id="open-h" class="lb-title">Open a document</h1>
          <p class="lb-lede">
            Read it in Midaad’s calm reader, then highlight and take notes. Your file is read on this computer and never
            uploaded.
          </p>

          <div class={`lb-drop${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}>
            {busy ? (
              <div class="lb-drop__busy" role="status" aria-live="polite">
                <span class="lb-spinner" aria-hidden="true" />
                <div>
                  <p class="lb-drop__title">Opening {status.name}</p>
                  <p class="lb-drop__sub">{status.detail ?? 'Converting for the reader…'}</p>
                </div>
              </div>
            ) : (
              <>
                <svg class="lb-drop__icon" width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M12 6h16l10 10v26H12z" fill="var(--mw-surface)" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                  <path d="M28 6v10h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                  <path d="M25 37V24m-5 5 5-5 5 5" fill="none" stroke="var(--mw-accent)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <p class="lb-drop__title">{dragging ? 'Drop to open' : 'Drop a file here'}</p>
                <p class="lb-drop__sub">or</p>
                <button type="button" class="lb-btn" onClick={() => inputRef.current?.click()}>
                  Choose a file
                </button>
                <ul class="lb-formats" aria-label="Supported formats">
                  {['PDF', 'EPUB', 'Word .docx', 'Text', 'HTML'].map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              class="mw-sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const input = e.currentTarget as HTMLInputElement;
                const file = input.files?.[0];
                input.value = ''; // so choosing the same file again still triggers a change
                if (file) onFile(file);
              }}
            />
          </div>

          {status.kind === 'error' && <ErrorCard status={status} onDismiss={props.onDismiss} />}
          {status.kind === 'password' && <PasswordCard status={status} onSubmit={props.onPassword} onCancel={props.onDismiss} />}
        </section>

        <section class="lb-recent" aria-labelledby="recent-h">
          <div class="lb-recent__head">
            <h2 id="recent-h" class="lb-h2">
              Recent
            </h2>
            {docs && docs.length > 6 && (
              <input
                type="search"
                class="lb-search"
                placeholder="Search your documents"
                aria-label="Search your documents"
                value={filter}
                onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)}
              />
            )}
          </div>

          {props.removed && (
            <p class="lb-removed" role="status">
              Removed “{props.removed.title}”. Its highlights are kept.{' '}
              <button type="button" class="lb-link" onClick={props.onUndoRemove}>
                Undo
              </button>
            </p>
          )}

          {docs === null ? null : docs.length === 0 ? (
            <p class="lb-empty">Documents you open will be listed here, so you can come back to them and to your notes.</p>
          ) : visible && visible.length === 0 ? (
            <p class="lb-empty">No documents match “{filter}”.</p>
          ) : (
            <ul class="lb-list">
              {visible!.map((d) => (
                <DocRow key={d.key} doc={d} onOpen={() => props.onOpen(d)} onRemove={() => props.onRemove(d)} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer class="lb-foot">
        <span class="op-dot" aria-hidden="true" /> Stored only in this browser. Removing a document doesn’t delete its
        highlights.
      </footer>
    </div>
  );
}

function DocRow({ doc, onOpen, onRemove }: { doc: DocumentRecord; onOpen: () => void; onRemove: () => void }) {
  const pct = Math.round(doc.progress * 100);
  const meta = [
    doc.author,
    doc.pages ? `${doc.pages} ${doc.pages === 1 ? 'page' : 'pages'}` : null,
    isTextless(doc) ? 'Scanned, no text' : `${doc.minutes} min read`,
    pct >= 99 ? 'Finished' : pct > 0 ? `${pct}% read` : null,
    `Opened ${relativeTime(doc.openedAt)}`,
  ].filter(Boolean);
  return (
    <li class="lb-doc">
      <button type="button" class="lb-doc__open" onClick={onOpen}>
        <span class={`lb-badge lb-badge--${doc.kind}`}>{KIND_LABELS[doc.kind]}</span>
        <span class="lb-doc__text">
          <span class="lb-doc__title" dir="auto" lang={doc.lang}>
            {doc.title}
          </span>
          <span class="lb-doc__meta">
            {meta.map((m, i) => (
              <span key={i} dir="auto">
                {m}
              </span>
            ))}
          </span>
          {pct > 0 && pct < 99 && (
            <span class="lb-doc__progress" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </span>
          )}
        </span>
      </button>
      <button type="button" class="lb-icon" aria-label={`Remove ${doc.title}`} title="Remove from Library" onClick={onRemove}>
        <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </li>
  );
}

function ErrorCard({ status, onDismiss }: { status: Extract<Status, { kind: 'error' }>; onDismiss: () => void }) {
  return (
    <div class="lb-alert" role="alert">
      <div>
        <p class="lb-alert__title">
          Couldn’t open <span dir="auto">{status.name}</span>
        </p>
        <p class="lb-alert__msg">{status.message}</p>
        {status.hint && <p class="lb-alert__hint">{status.hint}</p>}
      </div>
      <button type="button" class="lb-icon" aria-label="Dismiss" onClick={onDismiss}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>
  );
}

function PasswordCard({
  status,
  onSubmit,
  onCancel,
}: {
  status: Extract<Status, { kind: 'password' }>;
  onSubmit: (pw: string) => void;
  onCancel: () => void;
}) {
  const [pw, setPw] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), [status]);
  return (
    <form
      class="lb-alert lb-alert--neutral"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw) onSubmit(pw);
      }}
    >
      <div class="lb-pw">
        <label class="lb-alert__title" for="pdf-pw">
          <span dir="auto">{status.name}</span> is protected by a password
        </label>
        {status.wrong && (
          <p class="lb-alert__msg" role="alert">
            That password didn’t work. Try again.
          </p>
        )}
        <div class="lb-pw__row">
          <input
            id="pdf-pw"
            ref={ref}
            class="lb-input"
            type="password"
            autocomplete="off"
            value={pw}
            onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="submit" class="lb-btn" disabled={!pw}>
            Open
          </button>
          <button type="button" class="lb-btn lb-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <p class="lb-alert__hint">The password is used only to open the file and isn’t saved.</p>
      </div>
    </form>
  );
}

function relativeTime(t: number): string {
  const diff = Date.now() - t;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return rtf.format(-min, 'minute');
  const h = Math.round(min / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.round(h / 24);
  if (d < 30) return rtf.format(-d, 'day');
  return new Date(t).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function errorStatus(name: string, err: unknown): Status {
  if (err instanceof DocumentError) return { kind: 'error', name, message: err.message, hint: err.hint };
  console.error('[Midaad]', err);
  return {
    kind: 'error',
    name,
    message: 'Something went wrong while reading this file.',
    hint: 'If it opens in other apps, please try again. Some unusual files can’t be converted yet.',
  };
}
