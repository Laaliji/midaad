import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from '../../shared/highlights';
import { selectionActions } from './actions';

export type LayerState =
  | { kind: 'none' }
  | { kind: 'toolbar'; rects: () => DOMRectList | DOMRect[] }
  | { kind: 'popover'; id: string; rects: () => DOMRectList | DOMRect[]; focusNote: boolean };

export interface LayerProps {
  state: LayerState;
  highlight: Highlight | undefined;
  defaultColor: HighlightColor;
  /** What the toolbar acts on: selected text, or a box drawn on a picture. */
  mode: 'text' | 'area';
  onHighlight: (color: HighlightColor) => void;
  onHighlightWithNote: () => void;
  onAction: (id: string) => void;
  onSetColor: (id: string, color: HighlightColor) => void;
  onNote: (id: string, note: string) => void;
  onCopy: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Keeps the current selection alive while our buttons are pressed. */
const keepSelection = (e: Event) => e.preventDefault();

export function HighlightLayer(props: LayerProps) {
  const { state } = props;
  if (state.kind === 'toolbar') {
    return (
      <Floating rects={state.rects} key="toolbar">
        <Toolbar {...props} />
      </Floating>
    );
  }
  if (state.kind === 'popover' && props.highlight) {
    return (
      <Floating rects={state.rects} key={`pop-${state.id}`}>
        <Popover {...props} highlight={props.highlight} focusNote={state.focusNote} />
      </Floating>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ positioning */

const GAP = 10;
const MARGIN = 8;

/**
 * Positions its child next to the target text: above it when there's room, otherwise below.
 * Follows the text while you scroll, and hides when the text scrolls out of view.
 */
function Floating({ rects, children }: { rects: () => DOMRectList | DOMRect[]; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean; hidden: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const list = Array.from(rects()).filter((r) => r.width > 0 || r.height > 0);
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return setPos((p) => (p ? { ...p, hidden: true } : p));
      const vw = innerWidth;
      const vh = innerHeight;
      const { width: w, height: h } = el.getBoundingClientRect();
      const top = Math.min(...list.map((r) => r.top));
      const bottom = Math.max(...list.map((r) => r.bottom));
      const offscreen = bottom < 0 || top > vh;

      let below = first.top - GAP - h < MARGIN;
      let y = below ? last.bottom + GAP : first.top - GAP - h;
      if (below && y + h > vh - MARGIN) {
        below = false;
        y = Math.max(MARGIN, first.top - GAP - h);
      }
      const anchor = below ? last : first;
      const cx = anchor.left + anchor.width / 2;
      const x = Math.min(vw - MARGIN - w, Math.max(MARGIN, cx - w / 2));
      setPos({ x, y, below, hidden: offscreen });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const root = el.getRootNode() as Document | ShadowRoot;
    root.addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      root.removeEventListener('scroll', schedule, { capture: true });
      removeEventListener('scroll', schedule, { capture: true });
      removeEventListener('resize', schedule);
      ro.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [rects]);

  return (
    <div
      ref={ref}
      class={`mh-float${pos?.below ? ' is-below' : ''}${pos ? ' is-placed' : ''}`}
      style={{
        transform: pos ? `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px)` : undefined,
        visibility: !pos || pos.hidden ? 'hidden' : undefined,
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ selection toolbar */

function Toolbar({ defaultColor, mode, onHighlight, onHighlightWithNote, onAction, onClose }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Arrow keys move between buttons (WAI-ARIA toolbar pattern).
  function onKeyDown(e: KeyboardEvent) {
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = buttons.indexOf(e.target as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (i >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const next =
        e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }

  return (
    <div class="mh-toolbar" role="toolbar" aria-label={mode === 'area' ? 'Highlight this area' : 'Highlight selection'} ref={ref} onPointerDown={keepSelection} onMouseDown={keepSelection} onKeyDown={onKeyDown}>
      <div class="mh-swatches">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            type="button"
            key={c.id}
            class={`mh-swatch${c.id === defaultColor ? ' is-default' : ''}`}
            style={{ '--swatch': c.swatch }}
            aria-label={`Highlight in ${c.label}`}
            title={`Highlight · ${c.label}`}
            onClick={() => onHighlight(c.id)}
          />
        ))}
      </div>
      <span class="mh-sep" aria-hidden="true" />
      <IconButton label="Highlight and add a note" icon={ICONS.note} onClick={onHighlightWithNote} />
      {mode === 'text' && selectionActions.map((a) => (
        <IconButton key={a.id} label={a.label} icon={a.icon} onClick={() => onAction(a.id)} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ highlight popover */

function Popover({
  highlight,
  focusNote,
  onSetColor,
  onNote,
  onCopy,
  onDelete,
  onClose,
}: LayerProps & { highlight: Highlight; focusNote: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(focusNote || !!highlight.note);
  const [draft, setDraft] = useState(highlight.note);
  const [saved, setSaved] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timer = useRef(0);
  const latest = useRef({ draft, id: highlight.id, original: highlight.note });
  latest.current = { draft, id: highlight.id, original: latest.current.original };

  useEffect(() => {
    if (focusNote) textRef.current?.focus();
    else ref.current?.focus({ preventScroll: true });
  }, []);

  // Save whatever is typed when the popover closes.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      const { draft: d, id, original } = latest.current;
      if (d !== original) onNote(id, d);
    },
    [],
  );

  useLayoutEffect(() => autosize(textRef.current), [draft, editing]);

  function onInput(e: Event) {
    const value = (e.currentTarget as HTMLTextAreaElement).value;
    setDraft(value);
    setSaved('pending');
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      onNote(highlight.id, value);
      latest.current.original = value;
      setSaved('saved');
    }, 500);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onClose();
    }
  }

  const date = new Date(highlight.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' });

  return (
    <div class="mh-popover" role="dialog" aria-label={highlight.area ? `Highlight on page ${highlight.area.page}` : 'Highlight'} tabIndex={-1} ref={ref} onKeyDown={onKeyDown}>
      <div class="mh-popover__row" onPointerDown={keepSelection} onMouseDown={keepSelection}>
        <div class="mh-swatches" role="group" aria-label="Colour">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              type="button"
              key={c.id}
              class="mh-swatch"
              style={{ '--swatch': c.swatch }}
              aria-label={c.label}
              aria-pressed={c.id === highlight.color}
              title={c.label}
              onClick={() => onSetColor(highlight.id, c.id)}
            >
              {c.id === highlight.color && (
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M6 12.5l4 4 8-9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <span class="mh-grow" />
        {!editing && <IconButton label="Add a note" icon={ICONS.note} onClick={() => { setEditing(true); requestAnimationFrame(() => textRef.current?.focus()); }} />}
        {!highlight.area && <IconButton label="Copy text" icon={ICONS.copy} onClick={() => onCopy(highlight.id)} />}
        <IconButton label="Remove highlight" icon={ICONS.trash} danger onClick={() => onDelete(highlight.id)} />
      </div>

      {editing && (
        <div class="mh-note">
          <label class="mw-sr-only" for="mh-note-input">
            Note
          </label>
          <textarea
            id="mh-note-input"
            ref={textRef}
            class="mh-note__input"
            dir="auto"
            rows={2}
            maxLength={10000}
            placeholder="Write a note…"
            value={draft}
            onInput={onInput}
          />
          <div class="mh-note__foot">
            <span>{date}</span>
            <span aria-live="polite">{saved === 'pending' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`;
}

/* ------------------------------------------------------------------ bits */

export const ICONS = {
  note: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z M13.5 6.5l4 4',
  copy: 'M9 9h10v11H9z M5 15V4h10',
  trash: 'M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3',
};

function IconButton({ label, icon, onClick, danger }: { label: string; icon: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" class={`mh-icon${danger ? ' mh-icon--danger' : ''}`} aria-label={label} title={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d={icon} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  );
}
