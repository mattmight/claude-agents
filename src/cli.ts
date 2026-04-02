#!/usr/bin/env node
import { Command } from "commander";
import * as os from "node:os";
import { createColors, isColorEnabled } from "./utils/colors.js";
import { runProjectsCommand } from "./commands/projects.js";
import { runSessionsCommand } from "./commands/sessions.js";
import { runInspectCommand } from "./commands/inspect.js";
import { runStatusCommand, runStatusWatch } from "./commands/status.js";
import { runServeCommand } from "./commands/serve.js";
import { runDeleteCommand } from "./commands/delete.js";
import { runWatchCommand } from "./commands/watch.js";
import {
  generateBashCompletions,
  generateZshCompletions,
  generateFishCompletions,
} from "./commands/completions.js";

const program = new Command();

program
  .name("claude-agents")
  .description("Inspect and manage Claude Code sessions")
  .version("0.1.0")
  .option("--claude-dir <path>", "path to Claude data directory")
  .option("--json", "output as JSON")
  .option("--no-color", "disable color output")
  .option("--verbose", "include additional metadata");

program
  .command("projects")
  .description("List all known projects")
  .option("--active", "only show projects with active sessions")
  .option(
    "--sort <field>",
    "sort by path, last_active, or session_count",
    "path",
  )
  .action(async (cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
      json?: boolean;
      color: boolean;
      verbose?: boolean;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    const colors = createColors(globalOpts.color && isColorEnabled());
    const { output, isEmpty } = await runProjectsCommand(
      {
        active: cmdOpts.active as boolean | undefined,
        sort: cmdOpts.sort as "path" | "last_active" | "session_count",
        json: globalOpts.json,
        verbose: globalOpts.verbose,
        claudeDir,
      },
      colors,
    );
    process.stdout.write(output + "\n");
    if (isEmpty && cmdOpts.active) process.exit(2);
  });

program
  .command("sessions")
  .description("List sessions, optionally filtered by project")
  .argument("[project-path]", "filter to a specific project path")
  .option("--active", "only show active sessions")
  .option("--latest", "show only the most recent session per project")
  .option("--limit <n>", "maximum sessions to display", "50")
  .option(
    "--sort <field>",
    "sort by time, project, or status",
    "time",
  )
  .option(
    "--since <duration>",
    "only sessions active since duration (e.g., 1h, 7d)",
  )
  .option(
    "--format <type>",
    "output format: table, json, or csv",
  )
  .action(async (projectPath: string | undefined, cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
      json?: boolean;
      color: boolean;
      verbose?: boolean;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    const colors = createColors(globalOpts.color && isColorEnabled());

    // Determine format: --format flag takes priority, then --json global
    const format = (cmdOpts.format as string | undefined) ??
      (globalOpts.json ? "json" : undefined);

    const { output, isEmpty } = await runSessionsCommand(
      projectPath,
      {
        active: cmdOpts.active as boolean | undefined,
        latest: cmdOpts.latest as boolean | undefined,
        limit: parseInt(String(cmdOpts.limit), 10),
        sort: cmdOpts.sort as "time" | "project" | "status",
        since: cmdOpts.since as string | undefined,
        format: format as "table" | "json" | "csv" | undefined,
        verbose: globalOpts.verbose,
        claudeDir,
      },
      colors,
    );
    process.stdout.write(output + "\n");
    // Exit 2 when a filter was applied but no results found
    if (isEmpty && (cmdOpts.active || cmdOpts.since || projectPath)) {
      process.exit(2);
    }
  });

program
  .command("inspect")
  .description("Show detailed information about a single session")
  .argument("<session-id>", "session UUID or unique prefix")
  .action(async (sessionId: string, cmdOpts: Record<string, unknown>) => {
    void cmdOpts;
    const globalOpts = program.opts<{
      claudeDir?: string;
      json?: boolean;
      color: boolean;
      verbose?: boolean;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    const colors = createColors(globalOpts.color && isColorEnabled());
    try {
      const output = await runInspectCommand(
        sessionId,
        {
          json: globalOpts.json,
          verbose: globalOpts.verbose,
          claudeDir,
        },
        colors,
      );
      process.stdout.write(output + "\n");
    } catch (err: unknown) {
      process.stderr.write(
        (err instanceof Error ? err.message : String(err)) + "\n",
      );
      process.exit(1);
    }
  });

program
  .command("delete")
  .description("Delete session(s) and all associated files")
  .argument("[session-id]", "session UUID or unique prefix (omit for bulk ops)")
  .option("--dry-run", "show what would be deleted without acting")
  .option("--force", "skip active-session safety check and confirmation")
  .option("--all-stopped", "delete all sessions with status stopped")
  .option("--before <duration>", "only sessions older than duration (e.g., 30d)")
  .option("--project <path>", "only sessions in this project")
  .option("--prune-history", "also remove entries from history.jsonl")
  .action(async (sessionId: string | undefined, cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
      json?: boolean;
      color: boolean;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    const colors = createColors(globalOpts.color && isColorEnabled());
    try {
      const output = await runDeleteCommand(
        sessionId,
        {
          dryRun: cmdOpts.dryRun as boolean | undefined,
          force: cmdOpts.force as boolean | undefined,
          json: globalOpts.json,
          claudeDir,
          allStopped: cmdOpts.allStopped as boolean | undefined,
          before: cmdOpts.before as string | undefined,
          project: cmdOpts.project as string | undefined,
          pruneHistory: cmdOpts.pruneHistory as boolean | undefined,
        },
        colors,
      );
      process.stdout.write(output + "\n");
    } catch (err: unknown) {
      process.stderr.write(
        (err instanceof Error ? err.message : String(err)) + "\n",
      );
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Quick summary dashboard")
  .option("--watch", "re-scan and redraw on an interval")
  .option("--interval <seconds>", "refresh interval for watch mode", "5")
  .action(async (cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
      json?: boolean;
      color: boolean;
      verbose?: boolean;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    const colors = createColors(globalOpts.color && isColorEnabled());

    if (cmdOpts.watch) {
      await runStatusWatch(
        {
          json: globalOpts.json,
          verbose: globalOpts.verbose,
          claudeDir,
          watchInterval: parseInt(String(cmdOpts.interval), 10),
        },
        colors,
      );
    } else {
      const output = await runStatusCommand(
        {
          json: globalOpts.json,
          verbose: globalOpts.verbose,
          claudeDir,
        },
        colors,
      );
      process.stdout.write(output + "\n");
    }
  });

program
  .command("serve")
  .description("Start MCP server (stdio by default, or HTTP+SSE)")
  .option("--sse", "use HTTP+SSE transport instead of stdio")
  .option("--port <number>", "port for SSE transport", "3100")
  .action(async (cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    await runServeCommand({
      claudeDir,
      sse: cmdOpts.sse as boolean | undefined,
      port: cmdOpts.port ? parseInt(String(cmdOpts.port), 10) : undefined,
    });
  });

program
  .command("watch")
  .description("Watch for session changes (streaming NDJSON)")
  .option("--interval <seconds>", "scan interval in seconds", "5")
  .action(async (cmdOpts: Record<string, unknown>) => {
    const globalOpts = program.opts<{
      claudeDir?: string;
    }>();
    const claudeDir = resolveClaudeDir(globalOpts.claudeDir);
    await runWatchCommand({
      claudeDir,
      interval: parseInt(String(cmdOpts.interval), 10),
    });
  });

program
  .command("completions")
  .description("Generate shell completion scripts")
  .argument("<shell>", "shell type: bash, zsh, or fish")
  .action((shell: string) => {
    switch (shell) {
      case "bash":
        process.stdout.write(generateBashCompletions());
        break;
      case "zsh":
        process.stdout.write(generateZshCompletions());
        break;
      case "fish":
        process.stdout.write(generateFishCompletions());
        break;
      default:
        process.stderr.write(
          `Unknown shell "${shell}". Supported: bash, zsh, fish\n`,
        );
        process.exit(1);
    }
  });

function resolveClaudeDir(dir: string | undefined): string | undefined {
  if (!dir) return undefined;
  if (dir.startsWith("~")) return dir.replace("~", os.homedir());
  return dir;
}

program.parseAsync().catch((err: Error) => {
  process.stderr.write(err.message + "\n");
  process.exit(1);
});
