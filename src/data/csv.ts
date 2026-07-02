// Minimal RFC4180 CSV parsing (quoted fields with commas/quotes) — no dependency needed for the
// small balance tables in this directory. Structures/resources catalogs (D-058) live here so they're
// tunable in a spreadsheet instead of buried in engine code.

/** Parse CSV text (header row + data rows) into an array of header→value string maps. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\n') {
      pushField();
      pushRow();
    } else if (c === '\r') {
      // skip — \n follows
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  const dataRows = rows.filter((r) => r.length > 1 || r[0] !== '');
  const [header, ...body] = dataRows;
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Parse a numeric CSV cell; blank → 0. */
export function num(v: string | undefined): number {
  return v && v.length > 0 ? Number(v) : 0;
}
