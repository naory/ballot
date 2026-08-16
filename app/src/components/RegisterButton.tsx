"use client";

import { useState } from "react";
import { getIdentityProvider } from "@/lib/identity";
import { submitRegister } from "@/lib/hedera";
import { getWalletSigner } from "@/lib/wallet";

type Status =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "success"; commitment: string }
  | { kind: "error"; message: string };

export function RegisterButton() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const registryTopicId = process.env.NEXT_PUBLIC_REGISTRY_TOPIC_ID;
  const wallet = getWalletSigner();

  const handleRegister = async () => {
    if (!wallet || !registryTopicId) return;

    setStatus({ kind: "pending" });
    try {
      const provider = getIdentityProvider(wallet.accountId, wallet.signMessage);
      const msg = await provider.signRegistration();
      await submitRegister(wallet.client, registryTopicId, {
        type: "register",
        ...msg,
      });
      setStatus({ kind: "success", commitment: msg.commitment });
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const reset = () => setStatus({ kind: "idle" });

  if (status.kind === "success") {
    return (
      <div className="rounded-xl border border-green-700 bg-green-950 p-4 text-sm">
        <p className="font-semibold text-green-400">Registered!</p>
        <p className="mt-1 text-gray-400">
          Commitment:{" "}
          <code className="break-all text-xs text-gray-300">{status.commitment}</code>
        </p>
        <button onClick={reset} className="mt-2 text-indigo-400 underline text-xs">
          Register again
        </button>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="rounded-xl border border-red-800 bg-red-950 p-4 text-sm">
        <p className="font-semibold text-red-400">Registration failed</p>
        <p className="mt-1 text-gray-300">{status.message}</p>
        <button onClick={reset} className="mt-2 text-indigo-400 underline text-xs">
          Try again
        </button>
      </div>
    );
  }

  const pending = status.kind === "pending";

  if (!registryTopicId) {
    return (
      <button
        disabled
        className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-500 opacity-50 cursor-not-allowed"
      >
        Registration not configured.
      </button>
    );
  }

  if (!wallet) {
    return (
      <button
        disabled
        className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-500 opacity-50 cursor-not-allowed"
      >
        Connect a wallet to register.
      </button>
    );
  }

  return (
    <button
      onClick={handleRegister}
      disabled={pending}
      className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40"
    >
      {pending ? "Registering…" : "Register to vote"}
    </button>
  );
}
