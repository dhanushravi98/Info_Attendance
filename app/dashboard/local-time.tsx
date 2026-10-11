"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// Shows a database timestamp in the phone's own timezone. The server
// doesn't know that timezone, so it renders a placeholder and the
// browser fills in the real time after hydration.
export function LocalTime({ iso }: { iso: string }) {
  const isBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

  return (
    <time dateTime={iso}>{isBrowser ? formatLocal(iso) : "…"}</time>
  );
}

export function formatLocal(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
