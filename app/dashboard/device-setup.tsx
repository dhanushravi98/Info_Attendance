"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  WebAuthnError,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  startRegistration,
} from "@simplewebauthn/browser";

export function DeviceSetup({ deviceCount }: { deviceCount: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const hasDevice = deviceCount > 0;

  async function register() {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      if (!browserSupportsWebAuthn()) {
        throw new Error(
          "This browser doesn't support Face ID / fingerprint sign-in. Try Safari on iPhone or Chrome on Android."
        );
      }
      if (!(await platformAuthenticatorIsAvailable())) {
        throw new Error(
          "No Face ID or fingerprint is set up on this device. Turn it on in your phone's settings, then try again."
        );
      }

      // 1. Ask the server for a challenge.
      const optionsRes = await fetch("/api/webauthn/register/options", {
        method: "POST",
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error ?? "Could not start setup");

      // 2. Phone shows the Face ID / fingerprint prompt and creates a key.
      const response = await startRegistration({ optionsJSON: options });

      // 3. Server checks the response and saves the public key.
      const verifyRes = await fetch("/api/webauthn/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });
      const result = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(result.error ?? "Could not verify device");

      setSuccess(true);
      router.refresh(); // re-read the device count on the server
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Face ID / fingerprint</p>
      <p className="mt-1 text-lg font-semibold">
        {hasDevice
          ? `✅ ${deviceCount} device${deviceCount > 1 ? "s" : ""} registered`
          : "Not set up yet"}
      </p>

      {success && (
        <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          This device is now registered.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={register}
        disabled={loading}
        className="mt-4 h-14 w-full rounded-xl bg-zinc-900 text-lg font-semibold text-white transition-opacity disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {loading
          ? "Waiting for Face ID…"
          : hasDevice
            ? "Set up another device"
            : "Set up Face ID / fingerprint"}
      </button>
    </div>
  );
}

// Turn WebAuthn errors into messages an employee can act on.
function friendlyError(err: unknown): string {
  if (err instanceof WebAuthnError) {
    if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      return "This device is already registered for your account.";
    }
    if (err.code === "ERROR_INVALID_DOMAIN" || err.code === "ERROR_INVALID_RP_ID") {
      return "Setup isn't allowed on this web address. Open the app from its official HTTPS link.";
    }
    if (err.code === "ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT") {
      return "This device can't verify Face ID or fingerprint.";
    }
    // Cancelling the prompt (or letting it time out) arrives here.
    if (err.cause instanceof Error && err.cause.name === "NotAllowedError") {
      return "Setup was cancelled or timed out. Tap the button to try again.";
    }
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
