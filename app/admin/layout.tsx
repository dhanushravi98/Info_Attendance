import { AdminNav } from "./admin-nav";

// No data here, so no admin check: proxy.ts 404s non-admins before this
// renders, and each page still calls requireAdmin() before reading data
// (pages render in parallel with layouts, so a check here wouldn't protect them).
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <AdminNav />
      {children}
    </div>
  );
}
