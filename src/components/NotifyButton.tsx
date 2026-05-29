"use client";

import { useState } from "react";

type State = "idle" | "sending" | "sent" | "error";

export default function NotifyButton() {
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClick() {
    setState("sending");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/notify/whatsapp", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.sent) {
        setState("sent");
      } else {
        setState("error");
        setErrorMsg(data.reason ?? "Failed to send");
      }
    } catch (err) {
      setState("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send");
    }
    setTimeout(() => {
      setState("idle");
      setErrorMsg(null);
    }, 4000);
  }

  const label =
    state === "sending"
      ? "Sending…"
      : state === "sent"
        ? "✓ Sent!"
        : state === "error"
          ? "✗ Failed"
          : "📲 Notify Group";

  return (
    <div className="notify-wrap">
      <button
        className={`notify-btn notify-btn--${state}`}
        onClick={handleClick}
        disabled={state === "sending" || state === "sent"}
      >
        {label}
      </button>
      {state === "error" && errorMsg && (
        <p className="notify-error">{errorMsg}</p>
      )}
    </div>
  );
}
