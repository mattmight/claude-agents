const DURATION_RE = /^(\d+)\s*(s|m|h|d|w)$/i;

const MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * Parse a duration string like "1h", "7d", "30m", "2w", "10s" into milliseconds.
 * Throws an Error with a descriptive message if the format is invalid.
 */
export function parseDuration(input: string): number {
  const match = input.match(DURATION_RE);
  if (!match) {
    throw new Error(
      `Invalid duration "${input}". Expected a number followed by s, m, h, d, or w (e.g., "1h", "7d").`,
    );
  }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  return value * MULTIPLIERS[unit];
}
