"use client";

import { useState } from "react";

export default function CalendarLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (e.g. insecure context); the
      // input is still selectable so the user can copy manually.
    }
  }

  return (
    <div className="calendar-link">
      <p className="calendar-link-hint">Subscribe in Google Calendar</p>
      <div className="calendar-link-row">
        <input
          type="text"
          readOnly
          value={url}
          aria-label="Google Calendar subscription link"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}
