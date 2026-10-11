"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Today" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/qr", label: "QR codes" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800 print:hidden">
      <nav className="mx-auto flex w-full max-w-5xl items-center gap-1 overflow-x-auto px-4 py-3">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
        <Link
          href="/dashboard"
          className="ml-auto shrink-0 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          My dashboard
        </Link>
      </nav>
    </header>
  );
}
