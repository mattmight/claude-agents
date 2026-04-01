export interface ColorFunctions {
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
}

const CODES = {
  bold: ["\x1b[1m", "\x1b[22m"],
  dim: ["\x1b[2m", "\x1b[22m"],
  red: ["\x1b[31m", "\x1b[39m"],
  green: ["\x1b[32m", "\x1b[39m"],
  yellow: ["\x1b[33m", "\x1b[39m"],
  cyan: ["\x1b[36m", "\x1b[39m"],
} as const;

const identity = (s: string): string => s;

export function createColors(enabled: boolean): ColorFunctions {
  if (!enabled) {
    return { bold: identity, dim: identity, red: identity, green: identity, yellow: identity, cyan: identity };
  }
  const wrap = (key: keyof typeof CODES) => (s: string): string =>
    `${CODES[key][0]}${s}${CODES[key][1]}`;

  return {
    bold: wrap("bold"),
    dim: wrap("dim"),
    red: wrap("red"),
    green: wrap("green"),
    yellow: wrap("yellow"),
    cyan: wrap("cyan"),
  };
}

export function isColorEnabled(): boolean {
  return !process.env.NO_COLOR;
}
