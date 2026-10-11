import { Suspense } from "react";
import type { Metadata } from "next";
import { getReportSettings, loadEmployees, loadEvents, requireAdmin } from "@/lib/admin";
import { buildDailyRows, formatDate, localDate, summarize } from "@/lib/attendance-report";
import { AttendanceTable } from "./attendance-table";

export const metadata: Metadata = {
  title: "Today's attendance",
  robots: { index: false },
};

export default function AdminTodayPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Today />
      </Suspense>
    </main>
  );
}

async function Today() {
  // Pages render alongside the layout, so check here too before reading data.
  await requireAdmin();

  const { timeZone, workStartSeconds, workStartLabel } = getReportSettings();
  // The server's clock decides what "today" is, in the office timezone.
  const today = localDate(new Date(), timeZone);

  const [employees, events] = await Promise.all([
    loadEmployees(),
    loadEvents({ startDate: today, endDate: today, timeZone, employeeId: null }),
  ]);

  const rows = buildDailyRows({
    employees,
    events,
    startDate: today,
    endDate: today,
    today,
    timeZone,
    workStartSeconds,
  });
  const counts = summarize(rows);
  const dayOff = rows.some((row) => row.status === "Day off");

  return (
    <>
      <h1 className="text-3xl font-semibold">Today</h1>
      <p className="mt-1 text-zinc-600 dark:text-zinc-400">
        {formatDate(today)} · times in {timeZone}
        {workStartLabel && <> · late after {workStartLabel}</>}
      </p>

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Employees" value={counts.total} />
        <Stat label="On site" value={counts.checkedIn} />
        <Stat label="Checked out" value={counts.checkedOut} />
        <Stat label="Absent" value={counts.absent} />
        {workStartLabel && <Stat label="Late" value={counts.late} />}
      </dl>

      {dayOff && (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Today isn&apos;t a working day, so nobody is marked Absent.
        </p>
      )}

      <div className="mt-6">
        {rows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No employees yet.</p>
        ) : (
          <AttendanceTable rows={rows} timeZone={timeZone} showDate={false} />
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <dt className="text-sm text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
