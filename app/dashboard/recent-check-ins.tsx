import { createClient } from "@/lib/supabase/server";
import { LocalTime } from "./local-time";

// The employee's last 10 check-ins. Uses the normal (anon key + session)
// client, so Row Level Security decides which rows come back.
export async function RecentCheckIns({ userId }: { userId: string }) {
  const supabase = await createClient();

  const { data: events, error } = await supabase
    .from("attendance_events")
    .select("id, created_at, locations(name)")
    .eq("employee_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Recent check-ins</p>

      {error ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">
          Couldn&apos;t load your check-ins.
        </p>
      ) : !events || events.length === 0 ? (
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">No check-ins yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {events.map((event) => (
            <li key={event.id} className="flex justify-between gap-4 py-3">
              <span className="font-medium">
                {locationName(event.locations)}
              </span>
              <span className="text-right text-zinc-600 dark:text-zinc-400">
                <LocalTime iso={event.created_at} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Without generated DB types, supabase-js can't tell if the join is one row
// or many, so accept either shape.
function locationName(
  locations: { name: string } | { name: string }[] | null
): string {
  const location = Array.isArray(locations) ? locations[0] : locations;
  return location?.name ?? "Unknown location";
}
