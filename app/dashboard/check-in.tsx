"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WebAuthnError, startAuthentication } from "@simplewebauthn/browser";
import { formatLocal } from "./local-time";

type Result = { kind: "success" | "info" | "error"; text: string };

// idle -> scanning (camera on) -> verifying (camera off, Face ID) -> idle
type Phase = "idle" | "scanning" | "verifying";

export function CheckIn({ hasDevice }: { hasDevice: boolean }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<Result | null>(null);

  // The camera is on only while phase is "scanning". Leaving that phase for
  // any reason (code read, Cancel, error, page closed) runs the cleanup,
  // which releases the camera.
  useEffect(() => {
    if (phase !== "scanning") return;

    let cleanedUp = false;
    let scanner: import("qr-scanner").default | null = null;

    async function startCamera() {
      // Loaded on demand: it's only needed after the tap, and it touches
      // browser-only APIs.
      const { default: QrScanner } = await import("qr-scanner");
      if (cleanedUp || !videoRef.current) return;

      scanner = new QrScanner(
        videoRef.current,
        (scan) => {
          if (cleanedUp || !scan.data) return;
          cleanedUp = true; // ignore any further reads of the same code
          scanner?.stop(); // camera off right away, before the network calls
          setPhase("verifying");
          void runCheckIn(scan.data).then((outcome) => {
            setResult(outcome);
            setPhase("idle");
            router.refresh(); // reload the recent check-ins list
          });
        },
        {
          preferredCamera: "environment", // rear camera
          highlightScanRegion: true,
          returnDetailedScanResult: true,
          onDecodeError: () => {}, // "no QR code in this frame" — keep looking
        }
      );

      try {
        await scanner.start();
      } catch (err) {
        if (cleanedUp) return; // cancelled while the camera was starting
        setResult({ kind: "error", text: cameraError(err) });
        setPhase("idle");
      }
    }

    void startCamera();

    return () => {
      cleanedUp = true;
      scanner?.destroy(); // stops the video stream and turns the camera off
    };
  }, [phase, router]);

  function startScanning() {
    setResult(null);
    setPhase("scanning");
  }

  const resultStyles = {
    success: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
    info: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    error: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  };

  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Check in</p>

      {!hasDevice && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Set up Face ID / fingerprint above before checking in.
        </p>
      )}

      {phase === "scanning" && (
        <>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Point your camera at the QR code on the wall.
          </p>
          {/* qr-scanner adds its scan-region overlay next to the video, so
              the video gets a wrapper of its own. */}
          <div className="relative mt-4 aspect-square overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-cover"
            />
          </div>
        </>
      )}

      {result && phase === "idle" && (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={`mt-4 whitespace-pre-line rounded-lg p-3 text-sm ${resultStyles[result.kind]}`}
        >
          {result.text}
        </p>
      )}

      {phase === "scanning" ? (
        <button
          type="button"
          onClick={() => setPhase("idle")}
          className="mt-4 h-14 w-full rounded-xl border border-zinc-300 text-lg font-semibold dark:border-zinc-700"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={startScanning}
          disabled={phase === "verifying" || !hasDevice}
          className="mt-4 h-14 w-full rounded-xl bg-blue-600 text-lg font-semibold text-white transition-opacity disabled:opacity-50"
        >
          {phase === "verifying" ? "Waiting for Face ID…" : "Check in"}
        </button>
      )}
    </div>
  );
}

// Runs the check-in for a scanned code and returns the message to show.
async function runCheckIn(locationCode: string): Promise<Result> {
  try {
    // 1. Send the scanned code; the server checks it's a real location and
    //    creates a challenge. An unknown code fails HERE, so the Face ID
    //    prompt never appears for it.
    const optionsRes = await fetch("/api/checkin/options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationCode }),
    });
    const options = await optionsRes.json();
    if (!optionsRes.ok) throw new Error(options.error ?? "Could not start check-in");

    // 2. Phone shows the Face ID / fingerprint prompt and signs it.
    const response = await startAuthentication({ optionsJSON: options });

    // 3. Server verifies the signature and records the check-in.
    const verifyRes = await fetch("/api/checkin/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    });
    const data = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(data.error ?? "Check-in failed");

    if (data.alreadyCheckedIn) {
      return { kind: "info", text: data.message };
    }
    return {
      kind: "success",
      text: `Checked in at ${data.locationName} — ${formatLocal(data.createdAt)}`,
    };
  } catch (err) {
    return { kind: "error", text: friendlyError(err) };
  }
}

// Turn camera errors into messages an employee can act on.
function cameraError(err: unknown): string {
  if (!window.isSecureContext) {
    return "The camera only works over HTTPS. Open the app from its official HTTPS link.";
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return [
      "Camera access is blocked for this site.",
      "iPhone (Safari): tap “aA” in the address bar → Website Settings → Camera → Allow. If that's not there, go to Settings → Apps → Safari → Camera → Allow.",
      "Android (Chrome): tap the icon left of the address → Permissions → Camera → Allow.",
      "Then tap Check in again.",
    ].join("\n");
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is being used by another app. Close it and tap Check in again.";
  }
  // qr-scanner rejects with the plain string "Camera not found." when the
  // device has no camera; the browser uses NotFoundError for the same thing.
  if (name === "NotFoundError" || name === "OverconstrainedError" || String(err).includes("Camera not found")) {
    return "No camera was found on this device. Check in from a phone with a camera.";
  }
  return "Couldn't start the camera. Tap Check in to try again.";
}

// Turn WebAuthn errors into messages an employee can act on.
function friendlyError(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_INVALID_DOMAIN" || err.code === "ERROR_INVALID_RP_ID") {
      return "Check-in isn't allowed on this web address. Open the app from its official HTTPS link.";
    }
    // Cancelling the prompt, timing out, or having no registered key on
    // this phone all arrive here.
    if (err.cause instanceof Error && err.cause.name === "NotAllowedError") {
      return "Check-in was cancelled or timed out, or this phone isn't registered. Tap Check in to try again.";
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
