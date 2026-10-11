"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="h-12 rounded-xl bg-zinc-900 px-6 font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900"
    >
      Print
    </button>
  );
}
