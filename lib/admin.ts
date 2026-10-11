import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDays,
  assertTimeZone,
  buildDailyRows,
  localDate,
  parseReportFilters,
  parseWorkStartTime,
  reportRows,
  startOfDayUtc,
  type ReportEmployee,
  type ReportEvent,
} from "@/lib/attendance-report";

// Every /admin page and route calls this BEFORE reading any data.
// Signed out -> /login. Signed in but not an admin -> plain 404, so the
// admin area doesn't even admit it exists.
// cache() means the layout and page share one check per request.
export const requireAdmin = cache(async () => {
  const supabase = await createClient();

  // getUser() checks the session with Supabase Auth, so it can be trusted.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // The admin client bypasses RLS, so filter by the verified user's id.
  const { data: employee } = await createAdminClient()
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (employee?.role !== "admin") {
    notFound();
  }

  return { userId: user.id };
});

// Read from env on every call so a misconfiguration shows up clearly.
export function getReportSettings() {
  const timeZone = process.env.OFFICE_TIMEZONE;
  if (!timeZone) throw new Error("Missing OFFICE_TIMEZONE (e.g. America/Detroit)");
  assertTimeZone(timeZone);
  return {
    timeZone,
    workStartSeconds: parseWorkStartTime(process.env.WORK_START_TIME),
    workStartLabel: process.env.WORK_START_TIME?.trim() || null,
  };
}

// Supabase returns at most 1000 rows per request, so fetch in pages.
const PAGE_SIZE = 1000;

async function fetchAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Could not load attendance data");
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return all;
  }
}

// Only call these after requireAdmin(): they use the service_role client
// to read every employee's rows.

export async function loadEmployees(): Promise<ReportEmployee[]> {
  const admin = createAdminClient();
  return fetchAll<ReportEmployee>((from, to) =>
    admin
      .from("employees")
      .select("id, full_name, email, created_at")
      .order("full_name")
      .order("id")
      .range(from, to)
  );
}

// Scans between two office calendar days (inclusive). Only the employee and
// the database timestamp are selected: never locations or their qr_code.
export async function loadEvents(input: {
  startDate: string;
  endDate: string;
  timeZone: string;
  employeeId: string | null;
}): Promise<ReportEvent[]> {
  const admin = createAdminClient();
  const from = startOfDayUtc(input.startDate, input.timeZone).toISOString();
  const until = startOfDayUtc(addDays(input.endDate, 1), input.timeZone).toISOString();

  return fetchAll<ReportEvent>((rangeFrom, rangeTo) => {
    let query = admin
      .from("attendance_events")
      .select("employee_id, created_at")
      .gte("created_at", from)
      .lt("created_at", until);
    if (input.employeeId) query = query.eq("employee_id", input.employeeId);
    return query.order("created_at").order("id").range(rangeFrom, rangeTo);
  });
}

// Everything /admin/reports and its CSV export show, from the URL's search
// params. Both call this so the CSV always matches the table.
export async function loadReport(params: Record<string, string | string[] | undefined>) {
  const { timeZone, workStartSeconds, workStartLabel } = getReportSettings();
  // The server's clock decides what "today" is, in the office timezone.
  const today = localDate(new Date(), timeZone);

  const employees = await loadEmployees();
  const filters = parseReportFilters(
    params,
    today,
    employees.map((e) => e.id)
  );

  const events = await loadEvents({ ...filters, timeZone });
  const rows = reportRows(
    buildDailyRows({
      employees: filters.employeeId
        ? employees.filter((e) => e.id === filters.employeeId)
        : employees,
      events,
      startDate: filters.startDate,
      endDate: filters.endDate,
      today,
      timeZone,
      workStartSeconds,
    })
  );

  return { employees, filters, rows, today, timeZone, workStartLabel };
}
