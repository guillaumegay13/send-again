const APOSTROPHE_CHARS = /[\u2018\u2019\u201b\u2032\u02bc\uFF07]/g;
const QUOTE_CHARS = /[\u201c\u201d\u2033\uFF02]/g;

export function normalizeHistorySubject(value: string): string {
  return value
    .normalize("NFKC")
    .replace(APOSTROPHE_CHARS, "'")
    .replace(QUOTE_CHARS, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
