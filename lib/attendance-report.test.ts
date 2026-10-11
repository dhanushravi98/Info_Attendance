// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDailyRows,
  csvCell,
  formatDuration,
  localDate,
  parseReportFilters,
  parseWorkStartTime,
  reportRows,
  rowsToCsv,
  startOfDayUtc,
  summarize,
  type ReportEmployee,
} from "./attendance-report.ts";

const TZ = "America/Detroit"; // UTC-4 in summer (EDT), UTC-5 in winter (EST)
const NINE_AM = 9 * 3600;

const alice: ReportEmployee = {
  id: "a",
  full_name: "Alice",
  email: "alice@example.com",
  created_at: "2026-01-01T00:00:00Z",
};
const bob: ReportEmployee = {
  id: "b",
  full_name: "Bob",
  email: "bob@example.com",
  created_at: "2026-01-01T00:00:00Z",
};

// 2026-10-07 is a Wednesday, 2026-10-10 a Saturday.
function rowsFor(events: { employee_id: string; created_at: string }[], extra = {}) {
  return buildDailyRows({
    employees: [alice, bob],
    events,
    startDate: "2026-10-07",
    endDate: "2026-10-07",
    today: "2026-10-08",
    timeZone: TZ,
    workStartSeconds: NINE_AM,
    ...extra,
  });
}

test("groups by the office's calendar day, not UTC", () => {
  // 01:30 UTC on Oct 8 is 21:30 on Oct 7 in Detroit.
  assert.equal(localDate("2026-10-08T01:30:00Z", TZ), "2026-10-07");
  assert.equal(localDate("2026-10-08T04:30:00Z", TZ), "2026-10-08");

  const [row] = rowsFor([
    { employee_id: "a", created_at: "2026-10-07T13:00:00Z" }, // 09:00 local
    { employee_id: "a", created_at: "2026-10-08T01:30:00Z" }, // 21:30 local, same day
  ]);
  assert.equal(row.date, "2026-10-07");
  assert.equal(row.scanCount, 2);
  assert.equal(row.checkOut, "2026-10-08T01:30:00Z");
});

test("first scan is check-in, last is check-out, time on site is the gap", () => {
  const [row] = rowsFor([
    { employee_id: "a", created_at: "2026-10-07T17:00:00Z" },
    { employee_id: "a", created_at: "2026-10-07T12:55:00Z" }, // out of order on purpose
    { employee_id: "a", created_at: "2026-10-07T21:10:00Z" },
  ]);
  assert.equal(row.checkIn, "2026-10-07T12:55:00Z");
  assert.equal(row.checkOut, "2026-10-07T21:10:00Z");
  assert.equal(row.timeOnSiteMs, (8 * 60 + 15) * 60_000);
  assert.equal(row.scanCount, 3);
  assert.equal(row.status, "Checked out");
  assert.equal(row.late, false); // 08:55 local
});

test("one scan: no check-out; Checked in today, No check-out on a past day", () => {
  const today = rowsFor([{ employee_id: "a", created_at: "2026-10-07T14:00:00Z" }], {
    today: "2026-10-07",
  })[0];
  assert.equal(today.status, "Checked in");
  assert.equal(today.checkOut, null);
  assert.equal(today.timeOnSiteMs, null);

  const past = rowsFor([{ employee_id: "a", created_at: "2026-10-07T14:00:00Z" }])[0];
  assert.equal(past.status, "No check-out");
  assert.equal(past.checkOut, null);
});

test("no scans: Absent on a working day, Day off at the weekend", () => {
  const weekday = rowsFor([]);
  assert.deepEqual(
    weekday.map((r) => [r.employeeName, r.status]),
    [
      ["Alice", "Absent"],
      ["Bob", "Absent"],
    ]
  );

  const saturday = rowsFor([], { startDate: "2026-10-10", endDate: "2026-10-10", today: "2026-10-11" });
  assert.equal(saturday[0].status, "Day off");
  assert.deepEqual(reportRows(saturday), []);
});

test("Late only when the check-in is after WORK_START_TIME", () => {
  const rows = rowsFor([
    { employee_id: "a", created_at: "2026-10-07T13:00:00Z" }, // 09:00:00 exactly
    { employee_id: "b", created_at: "2026-10-07T13:01:00Z" }, // 09:01
  ]);
  assert.equal(rows[0].late, false);
  assert.equal(rows[1].late, true);

  const noStartTime = rowsFor([{ employee_id: "b", created_at: "2026-10-07T15:00:00Z" }], {
    workStartSeconds: null,
  });
  assert.equal(noStartTime[1].late, false);
});

test("Late uses local time on both sides of daylight saving", () => {
  // Winter (EST, UTC-5): 14:05 UTC is 09:05 local -> late.
  // Summer (EDT, UTC-4): 13:05 UTC is 09:05 local -> late; 12:55 UTC is 08:55 -> on time.
  const rows = buildDailyRows({
    employees: [alice],
    events: [
      { employee_id: "a", created_at: "2026-01-14T14:05:00Z" },
      { employee_id: "a", created_at: "2026-07-15T13:05:00Z" },
      { employee_id: "a", created_at: "2026-07-16T12:55:00Z" },
    ],
    startDate: "2026-01-14",
    endDate: "2026-07-16",
    today: "2026-10-11",
    timeZone: TZ,
    workStartSeconds: NINE_AM,
  });
  const byDate = new Map(rows.map((r) => [r.date, r]));
  assert.equal(byDate.get("2026-01-14")?.late, true);
  assert.equal(byDate.get("2026-07-15")?.late, true);
  assert.equal(byDate.get("2026-07-16")?.late, false);
});

test("skips future days and days before the employee joined; newest first", () => {
  const newStarter = { ...bob, created_at: "2026-10-07T15:00:00Z" };
  const rows = buildDailyRows({
    employees: [alice, newStarter],
    events: [],
    startDate: "2026-10-05",
    endDate: "2026-10-20",
    today: "2026-10-07",
    timeZone: TZ,
    workStartSeconds: null,
  });
  assert.deepEqual(
    rows.map((r) => `${r.date} ${r.employeeName}`),
    ["2026-10-07 Alice", "2026-10-07 Bob", "2026-10-06 Alice", "2026-10-05 Alice"]
  );
});

test("summary counts", () => {
  const rows = rowsFor(
    [
      { employee_id: "a", created_at: "2026-10-07T14:00:00Z" },
    ],
    { today: "2026-10-07" }
  );
  assert.deepEqual(summarize(rows), {
    total: 2,
    checkedIn: 1,
    checkedOut: 0,
    absent: 1,
    late: 1,
  });
});

test("startOfDayUtc handles both offsets and DST change days", () => {
  assert.equal(startOfDayUtc("2026-07-01", TZ).toISOString(), "2026-07-01T04:00:00.000Z");
  assert.equal(startOfDayUtc("2026-12-01", TZ).toISOString(), "2026-12-01T05:00:00.000Z");
  // Clocks change on these days; midnight is still before the change.
  assert.equal(startOfDayUtc("2026-03-08", TZ).toISOString(), "2026-03-08T05:00:00.000Z");
  assert.equal(startOfDayUtc("2026-11-01", TZ).toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(startOfDayUtc("2026-10-07", "UTC").toISOString(), "2026-10-07T00:00:00.000Z");
});

test("parseWorkStartTime", () => {
  assert.equal(parseWorkStartTime(undefined), null);
  assert.equal(parseWorkStartTime(""), null);
  assert.equal(parseWorkStartTime("09:00"), NINE_AM);
  assert.equal(parseWorkStartTime("9:30"), NINE_AM + 1800);
  assert.throws(() => parseWorkStartTime("9am"));
  assert.throws(() => parseWorkStartTime("25:00"));
});

test("parseReportFilters defaults, clamps and validates", () => {
  const ids = ["a", "b"];

  assert.deepEqual(parseReportFilters({}, "2026-10-11", ids), {
    startDate: "2026-10-05",
    endDate: "2026-10-11",
    employeeId: null,
    page: 1,
    notices: [],
  });

  const swapped = parseReportFilters({ from: "2026-10-09", to: "2026-10-01" }, "2026-10-11", ids);
  assert.equal(swapped.startDate, "2026-10-01");
  assert.equal(swapped.endDate, "2026-10-09");
  assert.equal(swapped.notices.length, 1);

  const future = parseReportFilters({ from: "2026-10-01", to: "2027-01-01" }, "2026-10-11", ids);
  assert.equal(future.endDate, "2026-10-11");

  const tooLong = parseReportFilters({ from: "2025-01-01", to: "2026-10-11" }, "2026-10-11", ids);
  assert.equal(tooLong.startDate, "2026-07-12"); // 92 days inclusive
  assert.equal(tooLong.notices.length, 1);

  const junk = parseReportFilters(
    { from: "2026-02-30", to: "nope", employee: "x'; drop", page: "-3" },
    "2026-10-11",
    ids
  );
  assert.equal(junk.startDate, "2026-10-05");
  assert.equal(junk.endDate, "2026-10-11");
  assert.equal(junk.employeeId, null);
  assert.equal(junk.page, 1);

  const picked = parseReportFilters({ employee: "b", page: ["3", "4"] }, "2026-10-11", ids);
  assert.equal(picked.employeeId, "b");
  assert.equal(picked.page, 3);
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(45 * 60_000 + 59_000), "45m");
  assert.equal(formatDuration((8 * 60 + 5) * 60_000), "8h 05m");
});

test("CSV escaping", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell("Smith, Jane"), '"Smith, Jane"');
  assert.equal(csvCell('Jane "JJ" Smith'), '"Jane ""JJ"" Smith"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(3), "3");
  // Spreadsheet formula injection
  assert.equal(csvCell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csvCell("@SUM(A1)"), "'@SUM(A1)");
});

test("rowsToCsv writes office-local times and blank check-out", () => {
  const rows = rowsFor([
    { employee_id: "a", created_at: "2026-10-07T13:30:00Z" },
    { employee_id: "a", created_at: "2026-10-07T21:45:15Z" },
    { employee_id: "b", created_at: "2026-10-07T14:00:00Z" },
  ]);
  const lines = rowsToCsv(rows, TZ).split("\r\n");
  assert.equal(
    lines[0],
    "Date,Employee,Email,Check-in,Check-out,Time on site (minutes),Scan count,Status,Late"
  );
  assert.equal(lines[1], "2026-10-07,Alice,alice@example.com,09:30:00,17:45:15,495,2,Checked out,Yes");
  assert.equal(lines[2], "2026-10-07,Bob,bob@example.com,10:00:00,,,1,No check-out,Yes");
  assert.equal(lines[3], "");
});
