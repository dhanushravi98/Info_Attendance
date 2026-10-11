// The attendance calculation shared by /admin, /admin/reports and the CSV
// export. Plain functions with no Supabase or Next.js imports, so they can
// be unit-tested: see attendance-report.test.ts (`npm test`).
//
// Dates are "YYYY-MM-DD" strings for a calendar day in the OFFICE timezone.
// Times are ISO strings from the database's now(), never from a phone.

export type ReportEmployee = {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
};

export type ReportEvent = {
  employee_id: string;
  created_at: string;
};

export type DayStatus =
  | "Checked in" // one scan, today: still on site
  | "Checked out" // two or more scans
  | "No check-out" // one scan on a past day: they never scanned out
  | "Absent" // no scans on a working day
  | "Day off"; // no scans on a weekend

export type DayRow = {
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  timeOnSiteMs: number | null;
  scanCount: number;
  status: DayStatus;
  late: boolean;
};

// Monday to Friday. (0 is Sunday, as in Date.getUTCDay.)
const WORKING_DAYS = new Set([1, 2, 3, 4, 5]);

// ---------------------------------------------------------------------------
// Timezone helpers (built on Intl, so no date library is needed)
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsIn(instant: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

// Throws a RangeError for a misspelled timezone such as "America/Detriot".
export function assertTimeZone(timeZone: string) {
  new Intl.DateTimeFormat("en-US", { timeZone });
}

// The office calendar day that an instant falls on.
export function localDate(instant: string | Date, timeZone: string): string {
  const p = partsIn(new Date(instant), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// Seconds since local midnight, e.g. 09:05:30 -> 32730.
function localSecondsOfDay(instant: string, timeZone: string): number {
  const p = partsIn(new Date(instant), timeZone);
  return p.hour * 3600 + p.minute * 60 + p.second;
}

// How far the timezone is ahead of UTC at that instant (negative = behind).
function offsetMs(instant: number, timeZone: string): number {
  const p = partsIn(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

// The UTC instant when an office calendar day begins. Used to turn a date
// range into a created_at range for the database query.
export function startOfDayUtc(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const midnightAsUtc = Date.UTC(y, m - 1, d);
  // Guess with the offset at UTC midnight, then correct once in case a
  // daylight-saving change happened in between.
  let guess = midnightAsUtc - offsetMs(midnightAsUtc, timeZone);
  guess = midnightAsUtc - offsetMs(guess, timeZone);
  return new Date(guess);
}

// ---------------------------------------------------------------------------
// Calendar day helpers (pure date math, no timezone involved)
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Inclusive count: daysInRange("2026-10-01", "2026-10-01") is 1.
export function daysInRange(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

export function isWorkingDay(date: string): boolean {
  return WORKING_DAYS.has(new Date(`${date}T00:00:00Z`).getUTCDay());
}

// "09:00" or "9:30" -> seconds since midnight. Empty/unset -> null (no Late
// flag). Anything else is a configuration mistake, so it throws.
export function parseWorkStartTime(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`WORK_START_TIME must look like 09:00, got "${value}"`);
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

// One row per employee per day from startDate to endDate (inclusive),
// newest day first, then by employee name.
//
// - Days after `today` are skipped (nothing has happened yet).
// - Days before the employee's account existed are skipped, so new
//   starters aren't shown as Absent for days before they joined.
// - Weekend days with no scans come back as "Day off"; the reports page
//   leaves those out.
export function buildDailyRows(input: {
  employees: ReportEmployee[];
  events: ReportEvent[];
  startDate: string;
  endDate: string;
  today: string;
  timeZone: string;
  workStartSeconds: number | null;
}): DayRow[] {
  const { employees, events, startDate, today, timeZone, workStartSeconds } = input;
  const endDate = input.endDate > today ? today : input.endDate;

  // Group scans by employee and office calendar day.
  const scansByKey = new Map<string, string[]>();
  for (const event of events) {
    const key = `${event.employee_id}|${localDate(event.created_at, timeZone)}`;
    const scans = scansByKey.get(key);
    if (scans) scans.push(event.created_at);
    else scansByKey.set(key, [event.created_at]);
  }

  const sortedEmployees = [...employees].sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  );

  const rows: DayRow[] = [];
  for (let date = endDate; date >= startDate; date = addDays(date, -1)) {
    for (const employee of sortedEmployees) {
      if (date < localDate(employee.created_at, timeZone)) continue;

      // Sort by actual instant; ISO strings with different offsets don't
      // always sort correctly as text.
      const scans = (scansByKey.get(`${employee.id}|${date}`) ?? [])
        .slice()
        .sort((a, b) => Date.parse(a) - Date.parse(b));

      const first = scans[0] ?? null;
      const last = scans.length >= 2 ? scans[scans.length - 1] : null;

      rows.push({
        employeeId: employee.id,
        employeeName: employee.full_name,
        employeeEmail: employee.email,
        date,
        checkIn: first,
        checkOut: last,
        timeOnSiteMs: first && last ? Date.parse(last) - Date.parse(first) : null,
        scanCount: scans.length,
        status: statusFor(scans.length, date, today),
        late:
          first !== null &&
          workStartSeconds !== null &&
          localSecondsOfDay(first, timeZone) > workStartSeconds,
      });
    }
  }
  return rows;
}

function statusFor(scanCount: number, date: string, today: string): DayStatus {
  if (scanCount >= 2) return "Checked out";
  if (scanCount === 1) return date === today ? "Checked in" : "No check-out";
  return isWorkingDay(date) ? "Absent" : "Day off";
}

export function summarize(rows: DayRow[]) {
  const counts = {
    total: rows.length,
    checkedIn: 0,
    checkedOut: 0,
    absent: 0,
    late: 0,
  };
  for (const row of rows) {
    if (row.status === "Checked in") counts.checkedIn++;
    if (row.status === "Checked out") counts.checkedOut++;
    if (row.status === "Absent") counts.absent++;
    if (row.late) counts.late++;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Report filters (from the URL's search params)
// ---------------------------------------------------------------------------

export const MAX_RANGE_DAYS = 92;
export const DEFAULT_RANGE_DAYS = 7;
export const ROWS_PER_PAGE = 50;

export type ReportFilters = {
  startDate: string;
  endDate: string;
  employeeId: string | null;
  page: number;
  notices: string[];
};

type SearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

// Turns ?from=&to=&employee=&page= into safe values. Bad input falls back
// to defaults with a notice instead of an error page. `employeeIds` is the
// list of real employees, so an unknown id is never passed to a query.
export function parseReportFilters(
  params: SearchParams,
  today: string,
  employeeIds: string[]
): ReportFilters {
  const notices: string[] = [];

  let endDate = single(params.to);
  if (!isValidDate(endDate)) endDate = today;
  if (endDate > today) endDate = today;

  let startDate = single(params.from);
  if (!isValidDate(startDate)) startDate = addDays(endDate, -(DEFAULT_RANGE_DAYS - 1));

  if (startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
    notices.push("The start date was after the end date, so they were swapped.");
  }
  if (daysInRange(startDate, endDate) > MAX_RANGE_DAYS) {
    startDate = addDays(endDate, -(MAX_RANGE_DAYS - 1));
    notices.push(`Ranges are limited to ${MAX_RANGE_DAYS} days, so the start date was moved.`);
  }

  let employeeId: string | null = single(params.employee) || null;
  if (employeeId && !employeeIds.includes(employeeId)) {
    employeeId = null;
    notices.push("That employee wasn't found, so everyone is shown.");
  }

  const pageNumber = Number.parseInt(single(params.page), 10);
  const page = Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;

  return { startDate, endDate, employeeId, page, notices };
}

// The rows the reports page and CSV show: every day with scans, plus
// Absent working days. Weekend days with no scans are left out.
export function reportRows(rows: DayRow[]): DayRow[] {
  return rows.filter((row) => row.status !== "Day off");
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// 8h 05m, 45m, 0m
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes}m`;
}

// "9:05 AM" in the office timezone, whatever timezone the viewer is in.
export function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

// "Mon, Oct 5, 2026" for a calendar date (no timezone shift).
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// "13:05:09" in the office timezone, for the CSV.
export function formatClock(iso: string, timeZone: string): string {
  const p = partsIn(new Date(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// RFC 4180 escaping: quote a cell that contains a comma, quote or line
// break, and double any quotes inside it. A cell starting with = + - @ or a
// tab could run as a formula in Excel/Sheets, so it gets a leading '.
export function csvCell(value: string | number | boolean | null): string {
  let text = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(rows: (string | number | boolean | null)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const CSV_HEADER = [
  "Date",
  "Employee",
  "Email",
  "Check-in",
  "Check-out",
  "Time on site (minutes)",
  "Scan count",
  "Status",
  "Late",
];

export function rowsToCsv(rows: DayRow[], timeZone: string): string {
  return toCsv([
    CSV_HEADER,
    ...rows.map((row) => [
      row.date,
      row.employeeName,
      row.employeeEmail,
      row.checkIn ? formatClock(row.checkIn, timeZone) : "",
      row.checkOut ? formatClock(row.checkOut, timeZone) : "",
      row.timeOnSiteMs === null ? "" : Math.floor(row.timeOnSiteMs / 60_000),
      row.scanCount,
      row.status,
      row.late ? "Yes" : "No",
    ]),
  ]);
}
