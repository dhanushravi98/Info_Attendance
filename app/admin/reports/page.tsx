import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { loadReport, requireAdmin } from "@/lib/admin";
import { MAX_RANGE_DAYS, ROWS_PER_PAGE, type ReportFilters } from "@/lib/attendance-report";
import { AttendanceTable } from "../attendance-table";

export const metadata: Metadata = {
  title: "Attendance reports",
  robots: { index: false },
};

export default function AdminReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-semibold">Reports</h1>
      <Suspense fallback={<p className="mt-6 text-zinc-500">Loading…</p>}>
        <Report searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Report({
  searchParams,
}: {
  searchParams: PageProps<"/admin/reports">["searchParams"];
}) {
  // Pages render alongside the layout, so check here too before reading data.
  await requireAdmin();

  const { employees, filters, rows, today, timeZone, workStartLabel } =
    await loadReport(await searchParams);

  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const page = Math.min(filters.page, pageCount);
  const pageRows = rows.slice((page - 1) * ROWS_PER_PAGE, page * ROWS_PER_PAGE);

  return (
    <>
      <form
        method="get"
        className="mt-6 grid grid-cols-2 gap-3 rounded-2xl border border-zinc-200 p-4 sm:grid-cols-4 sm:items-end dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="date"
            name="from"
            defaultValue={filters.startDate}
            max={today}
            className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="date"
            name="to"
            defaultValue={filters.endDate}
            max={today}
            className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-sm sm:col-span-1">
          Employee
          <select
            name="employee"
            defaultValue={filters.employeeId ?? ""}
            className="h-11 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
          >
            <option value="">Everyone</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="col-span-2 h-11 rounded-lg bg-zinc-900 px-4 font-semibold text-white sm:col-span-1 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Apply
        </button>
      </form>

      {filters.notices.map((notice) => (
        <p
          key={notice}
          className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {notice}
        </p>
      ))}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {rows.length} {rows.length === 1 ? "row" : "rows"} · times in {timeZone}
          {workStartLabel && <> · late after {workStartLabel}</>} · up to {MAX_RANGE_DAYS} days
        </p>
        {/* A plain <a>: it's a file download, not a page to navigate to. */}
        <a
          href={`/admin/reports/export?${query(filters)}`}
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Download CSV
        </a>
      </div>

      <div className="mt-3">
        {rows.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No attendance in this range.</p>
        ) : (
          <AttendanceTable rows={pageRows} timeZone={timeZone} showDate />
        )}
      </div>

      {pageCount > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3 text-sm">
          <PageLink filters={filters} page={page - 1} disabled={page <= 1}>
            ← Newer
          </PageLink>
          <span className="text-zinc-600 dark:text-zinc-400">
            Page {page} of {pageCount}
          </span>
          <PageLink filters={filters} page={page + 1} disabled={page >= pageCount}>
            Older →
          </PageLink>
        </nav>
      )}
    </>
  );
}

// The filters as a query string, so links keep the same range and employee.
function query(filters: ReportFilters, page?: number) {
  const params = new URLSearchParams({ from: filters.startDate, to: filters.endDate });
  if (filters.employeeId) params.set("employee", filters.employeeId);
  if (page && page > 1) params.set("page", String(page));
  return params.toString();
}

function PageLink({
  filters,
  page,
  disabled,
  children,
}: {
  filters: ReportFilters;
  page: number;
  disabled: boolean;
  children: ReactNode;
}) {
  if (disabled) {
    return <span className="px-3 py-2 text-zinc-400 dark:text-zinc-600">{children}</span>;
  }
  return (
    <Link
      href={`/admin/reports?${query(filters, page)}`}
      className="rounded-lg border border-zinc-300 px-3 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      {children}
    </Link>
  );
}
