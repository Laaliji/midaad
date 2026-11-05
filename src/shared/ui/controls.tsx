import type { ComponentChildren } from 'preact';
import { ARABIC_FONTS, LATIN_FONTS, fontStack } from '../fonts';
import {
  CONTENT_WIDTHS,
  LINE_HEIGHTS,
  READER_LIMITS,
  type ArabicFontId,
  type LatinFontId,
  type ReaderSettings,
  type ReaderTheme,
} from '../settings';

let uid = 0;
const nextId = (p: string) => `${p}-${++uid}`;

/* ------------------------------------------------------------------ Segmented (radio group) */

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ComponentChildren }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}

/** Real radio inputs underneath, so keyboard arrows and screen readers work for free. */
export function Segmented<T extends string | number>({ label, value, options, onChange, hideLabel }: SegmentedProps<T>) {
  const name = nextId('seg');
  return (
    <fieldset class="mw-field">
      <legend class={hideLabel ? 'mw-sr-only' : 'mw-field__label'}>{label}</legend>
      <div class="mw-segmented" style={{ '--count': options.length }}>
        {options.map((o) => (
          <label class="mw-segmented__item" key={String(o.value)}>
            <input
              type="radio"
              name={name}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
            />
            <span>
              {o.icon}
              {o.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Stepper */

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (n: number) => string;
  onChange: (v: number) => void;
}

export function Stepper({ label, value, min, max, step = 1, format = String, onChange }: StepperProps) {
  const id = nextId('stp');
  return (
    <div class="mw-field">
      <span class="mw-field__label" id={id}>
        {label}
      </span>
      <div class="mw-stepper" role="group" aria-labelledby={id}>
        <button
          type="button"
          class="mw-stepper__btn"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          <span class="mw-stepper__a mw-stepper__a--sm">A</span>
        </button>
        <input
          class="mw-stepper__range"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-labelledby={id}
          aria-valuetext={format(value)}
          onInput={(e) => onChange(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <button
          type="button"
          class="mw-stepper__btn"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          <span class="mw-stepper__a mw-stepper__a--lg">A</span>
        </button>
        <output class="mw-stepper__value" aria-hidden="true">
          {format(value)}
        </output>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Theme picker */

const THEMES: { value: ReaderTheme; label: string }[] = [
  { value: 'light', label: 'Paper' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Ink' },
];

export function ThemePicker({ value, onChange }: { value: ReaderTheme; onChange: (t: ReaderTheme) => void }) {
  const name = nextId('thm');
  return (
    <fieldset class="mw-field">
      <legend class="mw-field__label">Theme</legend>
      <div class="mw-themes">
        {THEMES.map((t) => (
          <label class="mw-theme" key={t.value}>
            <input type="radio" name={name} checked={value === t.value} onChange={() => onChange(t.value)} />
            <span class="mw-theme__swatch" data-theme={t.value} aria-hidden="true">
              Aa
            </span>
            <span class="mw-theme__label">{t.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Font picker */

interface FontPickerProps<T extends string> {
  label: string;
  value: T;
  fonts: Record<T, { label: string; short?: string; note: string }>;
  stackFor: (id: T) => string;
  sample: string;
  sampleDir?: 'ltr' | 'rtl';
  compact?: boolean;
  onChange: (id: T) => void;
}

export function FontPicker<T extends string>({ label, value, fonts, stackFor, sample, sampleDir, compact, onChange }: FontPickerProps<T>) {
  const name = nextId('fnt');
  return (
    <fieldset class="mw-field">
      <legend class="mw-field__label">{label}</legend>
      <div class={`mw-fonts${compact ? ' mw-fonts--compact' : ''}`}>
        {(Object.keys(fonts) as T[]).map((id) => (
          <label class="mw-font" key={id}>
            <input type="radio" name={name} checked={value === id} onChange={() => onChange(id)} />
            <span class="mw-font__sample" style={{ fontFamily: stackFor(id) }} dir={sampleDir} aria-hidden="true">
              {sample}
            </span>
            <span class="mw-font__text">
              <span class="mw-font__name">{compact ? (fonts[id].short ?? fonts[id].label) : fonts[id].label}</span>
              {!compact && <span class="mw-font__note">{fonts[id].note}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ Composite */

interface TypographyControlsProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  compact?: boolean;
  /** Show the Arabic font choice (always in options; in the reader only for Arabic articles). */
  showArabic?: boolean;
}

export function TypographyControls({ settings, onChange, compact, showArabic = true }: TypographyControlsProps) {
  return (
    <div class={`mw-typo${compact ? ' mw-typo--compact' : ''}`}>
      <ThemePicker value={settings.theme} onChange={(theme) => onChange({ theme })} />
      <FontPicker<LatinFontId>
        label="Font"
        value={settings.font}
        fonts={LATIN_FONTS}
        stackFor={(id) => fontStack(id, 'system')}
        sample="Ag"
        compact={compact}
        onChange={(font) => onChange({ font })}
      />
      {showArabic && (
        <FontPicker<ArabicFontId>
          label="Arabic font"
          value={settings.arabicFont}
          fonts={ARABIC_FONTS}
          stackFor={(id) => fontStack('system', id)}
          sample="مداد"
          sampleDir="rtl"
          compact={compact}
          onChange={(arabicFont) => onChange({ arabicFont })}
        />
      )}
      <Stepper
        label="Text size"
        value={settings.fontSize}
        min={READER_LIMITS.fontSize.min}
        max={READER_LIMITS.fontSize.max}
        format={(n) => `${n}px`}
        onChange={(fontSize) => onChange({ fontSize })}
      />
      <Segmented
        label="Line spacing"
        value={nearest(settings.lineHeight, LINE_HEIGHTS)}
        options={LINE_HEIGHTS}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />
      <Segmented
        label="Page width"
        value={nearest(settings.contentWidth, CONTENT_WIDTHS)}
        options={CONTENT_WIDTHS}
        onChange={(contentWidth) => onChange({ contentWidth })}
      />
    </div>
  );
}

function nearest(v: number, opts: readonly { value: number }[]): number {
  let best = opts[0]!.value;
  for (const o of opts) if (Math.abs(o.value - v) < Math.abs(best - v)) best = o.value;
  return best;
}

/* ------------------------------------------------------------------ Switch */

interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

/** A checkbox with role="switch", so it is announced as on/off. */
export function Switch({ label, description, checked, onChange }: SwitchProps) {
  const id = nextId('sw');
  return (
    <div class="mw-switch-row">
      <div class="mw-switch-row__text">
        <label class="mw-switch-row__label" for={id}>
          {label}
        </label>
        {description && (
          <p class="mw-switch-row__desc" id={`${id}-d`}>
            {description}
          </p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        class="mw-switch"
        checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
      />
    </div>
  );
}
