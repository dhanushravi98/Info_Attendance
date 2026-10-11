import type { NextRequest } from "next/server";
import { loadReport, requireAdmin } from "@/lib/admin";
import { rowsToCsv } from "@/lib/attendance-report";

// GET /admin/reports/export?from=&to=&employee=
// The same rows as /admin/reports (all pages), as a CSV download.
export async function GET(request: NextRequest) {
  // Signed out -> redirect to /login, not an admin -> 404. Before any reads.
  await requireAdmin();

  const { filters, rows, timeZone } = await loadReport(
    Object.fromEntries(request.nextUrl.searchParams)
  );

  const filename = `attendance_${filters.startDate}_to_${filters.endDate}.csv`;
  // The leading BOM tells Excel the file is UTF-8, so accented names show correctly.
  return new Response("\uFEFF" + rowsToCsv(rows, timeZone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Employee data: never store it in a shared/CDN cache.
      "Cache-Control": "private, no-store",
    },
  });
}
