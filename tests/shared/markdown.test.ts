import { escapeMarkdown, formatDateSafe, sanitizeMarkdownCode } from '../../src/shared/utils/index';

describe('escapeMarkdown', () => {
  it('escapes the four legacy-Markdown delimiters', () => {
    expect(escapeMarkdown('SM_A515F')).toBe('SM\\_A515F');
    expect(escapeMarkdown('Pixel*7')).toBe('Pixel\\*7');
    expect(escapeMarkdown('nod`e')).toBe('nod\\`e');
    expect(escapeMarkdown('[Redmi]')).toBe('\\[Redmi]');
  });

  it('leaves text without delimiters untouched', () => {
    expect(escapeMarkdown('iPhone 14 Pro')).toBe('iPhone 14 Pro');
    expect(escapeMarkdown('')).toBe('');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeMarkdown('a_b_c_d')).toBe('a\\_b\\_c\\_d');
  });
});

describe('sanitizeMarkdownCode', () => {
  it('strips characters that would break an inline-code entity', () => {
    expect(sanitizeMarkdownCode('ab`cd\\ef')).toBe('abcdef');
  });
});

describe('formatDateSafe', () => {
  it('formats valid dates and ISO strings', () => {
    expect(formatDateSafe('2026-03-04T10:20:00.000Z')).toMatch(/04\.03\.2026/);
    expect(formatDateSafe(new Date('2026-03-04T10:20:00.000Z'))).toMatch(/04\.03\.2026/);
  });

  it('returns null instead of throwing on unusable values', () => {
    expect(formatDateSafe('not-a-date')).toBeNull();
    expect(formatDateSafe(new Date('nope'))).toBeNull();
    expect(formatDateSafe(null)).toBeNull();
    expect(formatDateSafe(undefined)).toBeNull();
    expect(formatDateSafe('')).toBeNull();
  });
});
