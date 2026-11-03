/** The Midaad mark: a calligraphic meem (م) rising like ink from an open book. Theme-aware colors. */
export function MidaadMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      class="mw-mark"
      width={size}
      height={size}
      viewBox="8 14 112 92"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path
        d="M14 92 C 32 80, 50 81, 64 98 C 78 81, 96 80, 114 92"
        fill="none"
        stroke="var(--mw-mark-page)"
        stroke-width="10"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        fill="var(--mw-mark-ink)"
        fill-rule="evenodd"
        d="M56 42 C 58 28, 78 22, 89 30 C 97 36, 94 50, 82 54 C 74 57, 66 55, 61 52 C 59 64, 60 78, 65 90 C 53 80, 49 64, 56 42 Z M68 44 C 71 37, 80 35, 84 39 C 86 43, 81 47, 74 47 C 71 47, 69 46, 68 44 Z"
      />
    </svg>
  );
}

/** Mark + bilingual wordmark, echoing the logo lockup. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span class="mw-wordmark">
      <MidaadMark size={size} />
      <span class="mw-wordmark__latin">Midaad</span>
      <span class="mw-wordmark__arabic" lang="ar" dir="rtl">
        مداد
      </span>
    </span>
  );
}
