const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

/**
 * Normalizes a loosely-formatted date (AI output like "2020-05", a bare
 * year, or LinkedIn's "Jan 2020" export format) into the YYYY-MM-DD string
 * Postgres `date` columns require. Returns null when it can't be parsed.
 */
export function normalizeDate(input: string | null | undefined): string | null {
  if (!input) {
    return null;
  }
  const value = input.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (/^\d{4}-\d{2}$/.test(value)) {
    return `${value}-01`;
  }
  if (/^\d{4}$/.test(value)) {
    return `${value}-01-01`;
  }

  const monthYear = value.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (monthYear) {
    const month = MONTHS[monthYear[1].slice(0, 3).toLowerCase()];
    if (month) {
      return `${monthYear[2]}-${month}-01`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}
