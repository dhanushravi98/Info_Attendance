import {
  formatDate,
  formatDuration,
  formatTime,
  type DayRow,
  type DayStatus,
} from "@/lib/attendance-report";

const STATUS_STYLES: Record<DayStatus, string> = {
  "Checked in": "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  "Checked out": "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  "No check-out": "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  Absent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  "Day off": "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

// Employee x day table. Times are shown in the office timezone, rendered on
// the server, so every admin sees the same thing whatever their phone's
// timezone is. Scrolls sideways inside its own box on narrow screens.
export function AttendanceTable({
  rows,
  timeZone,
  showDate,
}: {
  rows: DayRow[];
  timeZone: string;
  showDate: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {showDate && <th className="px-4 py-3 font-medium">Date</th>}
            <th className="px-4 py-3 font-medium">Employee</th>
            <th className="px-4 py-3 font-medium">Check-in</th>
            <th className="px-4 py-3 font-medium">Check-out</th>
            <th className="px-4 py-3 font-medium">Time on site</th>
            <th className="px-4 py-3 text-right font-medium">Scans</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={`${row.employeeId}|${row.date}`}>
              {showDate && (
                <td className="whitespace-nowrap px-4 py-3">{formatDate(row.date)}</td>
              )}
              <td className="px-4 py-3">
                <div className="font-medium">{row.employeeName}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {row.employeeEmail}
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {row.checkIn ? (
                  <>
                    {formatTime(row.checkIn, timeZone)}
                    {row.late && (
                      <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200">
                        Late
                      </span>
                    )}
                  </>
                ) : (
                  <Dash />
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {row.checkOut ? (
                  formatTime(row.checkOut, timeZone)
                ) : row.checkIn ? (
                  <span className="text-zinc-500 dark:text-zinc-400">No check-out yet</span>
                ) : (
                  <Dash />
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3">
                {row.timeOnSiteMs === null ? <Dash /> : formatDuration(row.timeOnSiteMs)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.scanCount}</td>
              <td className="whitespace-nowrap px-4 py-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.status]}`}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dash() {
  return <span className="text-zinc-400 dark:text-zinc-500">—</span>;
}
