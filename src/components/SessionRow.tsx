"use client";

import { useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  dateLabel: string;
  startTime: string;
  court: string;
  bookingUrl: string;
  sessionKey: string;
  initialPlayers: string[];
  roster: readonly string[];
  maxPlayers: number;
};

export default function SessionRow({
  dateLabel,
  startTime,
  court,
  bookingUrl,
  sessionKey,
  initialPlayers,
  roster,
  maxPlayers,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>(() =>
    roster.filter((n) => initialPlayers.includes(n)),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function persist(next: string[]) {
    setSaveState("saving");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/sessions/players", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionKey, players: next }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `HTTP ${res.status}`);
      }
      setSaveState("saved");
      window.setTimeout(() => {
        setSaveState((s) => (s === "saved" ? "idle" : s));
      }, 1500);
    } catch (err) {
      setSaveState("error");
      setErrorMessage(err instanceof Error ? err.message : "save failed");
    }
  }

  function toggle(name: string) {
    const isOn = selected.includes(name);
    if (!isOn && selected.length >= maxPlayers) return;
    const next = isOn
      ? selected.filter((n) => n !== name)
      : [...selected, name];
    const ordered = roster.filter((n) => next.includes(n));
    setSelected(ordered);
    void persist(ordered);
  }

  function toggleExpanded() {
    setExpanded((v) => !v);
  }

  function onRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleExpanded();
    }
  }

  const count = selected.length;
  const full = count >= maxPlayers;
  const pillClass = `players-pill ${full ? "full" : count > 0 ? "partial" : "empty"}`;

  return (
    <>
      <tr
        className={`session-row ${expanded ? "expanded" : ""}`}
        onClick={toggleExpanded}
        onKeyDown={onRowKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
      >
        <td>{dateLabel}</td>
        <td>{startTime}</td>
        <td>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {court}
          </a>
        </td>
        <td>
          <span className={pillClass}>
            {count}/{maxPlayers}
            <span className="player-picker-caret">{expanded ? "▴" : "▾"}</span>
          </span>
        </td>
      </tr>
      {expanded ? (
        <tr className="session-row-expansion">
          <td colSpan={4}>
            <ul className="player-picker-list">
              {roster.map((name) => {
                const checked = selected.includes(name);
                const disabled = !checked && full;
                return (
                  <li key={name}>
                    <label className={disabled ? "disabled" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(name)}
                      />
                      <span>{name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className={`player-picker-status status-${saveState}`}>
              {saveState === "saving" ? "Saving…" : null}
              {saveState === "saved" ? "Saved" : null}
              {saveState === "error" ? `Error: ${errorMessage}` : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
