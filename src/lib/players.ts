export const PLAYERS: readonly string[] = [
  "Ian",
  "Senan",
  "Darach",
  "Will",
  "Alan",
  "Owen",
  "Darren",
] as const;

export const MAX_PLAYERS = 4;

export function isKnownPlayer(name: string): boolean {
  return PLAYERS.includes(name);
}
