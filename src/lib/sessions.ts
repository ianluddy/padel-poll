export type SessionKeyInput = {
  venue: string;
  date: string;
  startTime: string;
  court: string;
};

export function buildSessionKey(s: SessionKeyInput): string {
  return `${s.venue}|${s.date}|${s.startTime}|${s.court}`;
}
