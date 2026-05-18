export const PLAYERS: readonly string[] = [
  "Player 1",
  "Player 2",
  "Player 3",
  "Player 4",
  "Player 5",
  "Player 6",
  "Player 7",
  "Player 8",
] as const;

export const MAX_PLAYERS = 4;

export function isKnownPlayer(name: string): boolean {
  return PLAYERS.includes(name);
}
