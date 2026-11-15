export interface RepairableFont {
  toUnicode?: { get(code: number): string | undefined; charCodeOf(value: string): number };
}

/** The text a glyph should have, given the text the font's ToUnicode table gives it. */
export function repairUnicode(font: RepairableFont, code: number, text: string): string;
