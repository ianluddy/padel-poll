"use client";

import { useState } from "react";

type SaveState = "idle" | "saving" | "saved" | "error";

type Props = {
  sessionKey: string;
  initialPlayers: string[];
  roster: readonly string[];
  maxPlayers: number;
};

export default function SessionPlayerPicker({
  sessionKey,
  initialPlayers,
  roster,
  maxPlayers,
}: Props) {
  const [selected, setSelected] = useState<string[]>(() =>
    roster.filter((n) => initialPlayers.includes(n)),
  );
  const [expanded, setExpanded] = useState(false);
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

  const count = selected.length;
  const full = count >= maxPlayers;
  const pillClass = `players-pill ${full ? "full" : count > 0 ? "partial" : "empty"}`;

  return (
    <div className="player-picker">
      <button
        type="button"
        className={pillClass}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${count} of ${maxPlayers} players confirmed — ${expanded ? "collapse" : "expand"}`}
      >
        {count}/{maxPlayers}
        <span className="player-picker-caret">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded ? (
        <div className="player-picker-panel">
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
        </div>
      ) : null}
    </div>
  );
}
