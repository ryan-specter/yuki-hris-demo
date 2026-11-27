// Minimal RFC 4180 CSV writer. The BOM keeps non-ASCII names readable in Excel;
// every field is quoted only when it needs to be.
export function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header, rows) {
  const lines = [header, ...rows].map((cells) => cells.map(csvField).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
