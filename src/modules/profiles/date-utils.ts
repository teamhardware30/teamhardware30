const MONTHS: Record<string, string> = {
  jan: '01',
  january: '01',
  ene: '01',
  janv: '01',
  janvier: '01',
  feb: '02',
  february: '02',
  fevr: '02',
  févr: '02',
  février: '02',
  febrero: '02',
  mar: '03',
  march: '03',
  mars: '03',
  mär: '03',
  märz: '03',
  marzo: '03',
  apr: '04',
  april: '04',
  avr: '04',
  avril: '04',
  abr: '04',
  may: '05',
  mai: '05',
  mayo: '05',
  jun: '06',
  june: '06',
  juin: '06',
  junio: '06',
  jul: '07',
  july: '07',
  juil: '07',
  juillet: '07',
  julio: '07',
  aug: '08',
  august: '08',
  aout: '08',
  août: '08',
  ago: '08',
  agosto: '08',
  sep: '09',
  sept: '09',
  september: '09',
  septembre: '09',
  septiembre: '09',
  oct: '10',
  october: '10',
  octobre: '10',
  octubre: '10',
  okt: '10',
  nov: '11',
  november: '11',
  novembre: '11',
  noviembre: '11',
  dec: '12',
  december: '12',
  déc: '12',
  décembre: '12',
  diciembre: '12',
  dez: '12',
};

const PRESENT_VALUES = new Set(['present', 'current', 'now', 'today', 'till date', 'to date', 'présent', 'actualidad']);

/** Normalize a stated month to YYYY-MM without inventing a missing month. */
export function normalizeMonth(input: string | null | undefined): string | null {
  const value = clean(input);
  if (!value || isPresent(value)) {
    return null;
  }

  const iso = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = iso[3] === undefined ? 1 : Number(iso[3]);
    if (!validDate(year, month, day)) {
      return null;
    }
    return `${iso[1]}-${pad(month)}`;
  }

  const numericMonthYear = value.match(/^(\d{1,2})[/.](\d{4})$/);
  if (numericMonthYear) {
    const month = Number(numericMonthYear[1]);
    const year = Number(numericMonthYear[2]);
    return validDate(year, month, 1) ? `${numericMonthYear[2]}-${pad(month)}` : null;
  }

  const monthYear = value.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(?:de\s+)?(\d{4})$/i);
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLocaleLowerCase('fr')];
    return month ? `${monthYear[2]}-${month}` : null;
  }

  const yearMonth = value.match(/^(\d{4})[/.](\d{1,2})$/);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    return validDate(year, month, 1) ? `${yearMonth[1]}-${pad(month)}` : null;
  }

  return null;
}

export function normalizeMonthOrPresent(input: string | null | undefined): string | 'present' | null {
  const value = clean(input);
  if (value && isPresent(value)) {
    return 'present';
  }
  return normalizeMonth(value);
}

/** Normalize an education date to YYYY, or null when no valid year is stated. */
export function normalizeYear(input: string | null | undefined): string | null {
  const value = clean(input);
  if (/^\d{4}$/.test(value)) {
    return Number(value) >= 1000 ? value : null;
  }
  return normalizeMonth(value)?.slice(0, 4) ?? null;
}

/** Convert a validated/normalized date to the YYYY-MM-DD Postgres date format. */
export function normalizeDate(input: string | null | undefined): string | null {
  const value = clean(input);
  if (!value || isPresent(value)) {
    return null;
  }
  if (/^\d{4}$/.test(value)) {
    return Number(value) >= 1000 ? `${value}-01-01` : null;
  }
  const fullDate = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (fullDate) {
    const year = Number(fullDate[1]);
    const month = Number(fullDate[2]);
    const day = Number(fullDate[3]);
    return validDate(year, month, day) ? `${fullDate[1]}-${pad(month)}-${pad(day)}` : null;
  }
  const month = normalizeMonth(value);
  return month ? `${month}-01` : null;
}

function clean(input: string | null | undefined): string {
  return input?.trim().replace(/\s+/g, ' ') ?? '';
}

function isPresent(value: string): boolean {
  return PRESENT_VALUES.has(value.toLocaleLowerCase('en'));
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function validDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
