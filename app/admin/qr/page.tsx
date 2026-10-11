import { Suspense } from "react";
import type { Metadata } from "next";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin";
import { PrintButton } from "./print-button";

export const metadata: Metadata = {
  title: "Location QR codes",
  robots: { index: false },
};

export default function AdminQrPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10 print:max-w-none print:p-0">
      {/* Reading the session cookie happens per request, so with
          cacheComponents it must stream in behind a Suspense boundary. */}
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <LocationCodes />
      </Suspense>
    </main>
  );
}

async function LocationCodes() {
  // Signed out -> /login, not an admin -> 404. Runs BEFORE any qr_code is read.
  await requireAdmin();

  const admin = createAdminClient();
  const { data: locations, error } = await admin
    .from("locations")
    .select("id, name, qr_code")
    .order("name");

  if (error) {
    return <p className="text-red-700 dark:text-red-300">Couldn&apos;t load locations.</p>;
  }

  // Generated on the server as SVG, so it prints sharp at any size.
  const codes = await Promise.all(
    (locations ?? []).map(async (location) => ({
      id: location.id as string,
      name: location.name as string,
      svg: await QRCode.toString(location.qr_code, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }),
    }))
  );

  return (
    <>
      <div className="mb-8 flex items-center justify-between gap-4 print:hidden">
        <h1 className="text-3xl font-semibold">Location QR codes</h1>
        {codes.length > 0 && <PrintButton />}
      </div>

      {codes.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">No locations yet.</p>
      ) : (
        <div className="flex flex-col gap-10 print:block">
          {codes.map((code) => (
            <section
              key={code.id}
              // On paper: one QR per page, black on white.
              className="flex flex-col items-center rounded-2xl bg-white p-8 text-black print:rounded-none print:p-0 print:pt-[2cm] print:break-after-page print:last:break-after-auto"
            >
              {/* SVG markup produced by the qrcode package from our own data. */}
              <div
                className="w-full max-w-md [&>svg]:h-auto [&>svg]:w-full print:max-w-[16cm]"
                dangerouslySetInnerHTML={{ __html: code.svg }}
              />
              <p className="mt-6 text-center text-3xl font-bold print:text-5xl">
                {code.name}
              </p>
              <p className="mt-2 text-center text-lg print:text-2xl">
                Scan with the Attendance app to check in
              </p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
