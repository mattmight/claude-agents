import type { Session, ScannerOptions } from "../types.js";
import type { ColorFunctions } from "../utils/colors.js";
import { formatInspectDetail, formatInspectJson } from "../formatters/inspect.js";
import { enumerateAllSessions } from "../core/session-enumerator.js";
import { checkAllSessionsLiveness } from "../core/liveness.js";

export interface InspectCommandOptions {
  json?: boolean;
  verbose?: boolean;
  claudeDir?: string;
}

/**
 * Find a session by full UUID or unique prefix.
 * Returns the matched session, or throws with a descriptive message.
 */
export function resolveSessionById(
  sessions: Session[],
  idOrPrefix: string,
): Session {
  const lower = idOrPrefix.toLowerCase();

  // Try exact match first
  const exact = sessions.find((s) => s.id.toLowerCase() === lower);
  if (exact) return exact;

  // Try prefix match
  const matches = sessions.filter((s) =>
    s.id.toLowerCase().startsWith(lower),
  );

  if (matches.length === 0) {
    throw new Error(`No session found matching "${idOrPrefix}".`);
  }

  if (matches.length > 1) {
    const listing = matches
      .slice(0, 10)
      .map((s) => `  ${s.id}  ${s.projectPath ?? "(unknown)"}`)
      .join("\n");
    const extra = matches.length > 10 ? `\n  ... and ${matches.length - 10} more` : "";
    throw new Error(
      `Ambiguous session prefix "${idOrPrefix}" matches ${matches.length} sessions:\n${listing}${extra}`,
    );
  }

  return matches[0];
}

export async function runInspectCommand(
  sessionId: string,
  options: InspectCommandOptions,
  colors: ColorFunctions,
): Promise<string> {
  const scannerOptions: ScannerOptions = {};
  if (options.claudeDir) scannerOptions.claudeDir = options.claudeDir;

  const sessions = await enumerateAllSessions(scannerOptions);
  await checkAllSessionsLiveness(sessions, scannerOptions);

  const session = resolveSessionById(sessions, sessionId);

  if (options.json) {
    return formatInspectJson(session);
  }
  return formatInspectDetail(session, colors);
}
