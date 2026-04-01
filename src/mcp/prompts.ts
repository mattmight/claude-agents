import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  // session_overview — summary of all active sessions
  server.registerPrompt("session_overview", {
    title: "Session Overview",
    description:
      "Give me a summary of all active Claude Code sessions and what they're working on.",
  }, async () => {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: "Use the get_status tool to get the current Claude Code session status, then summarize what sessions are active and what they appear to be working on. Include project paths, branch names, and message counts.",
          },
        },
      ],
    };
  });

  // project_history — recent session history for a project
  server.registerPrompt("project_history", {
    title: "Project History",
    description:
      "Show me the recent session history for a specific project.",
    argsSchema: {
      project_path: z
        .string()
        .describe("The project path to show history for"),
    },
  }, async ({ project_path }) => {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use the list_sessions tool with project_path="${project_path}" to get the recent session history for this project. Summarize the sessions including their branches, status, message counts, and when they were last active.`,
          },
        },
      ],
    };
  });

  // find_work — search for a session by description
  server.registerPrompt("find_work", {
    title: "Find Work",
    description:
      "Find the session where I was working on something specific.",
    argsSchema: {
      description: z
        .string()
        .describe("Description of what you were working on"),
    },
  }, async ({ description }) => {
    return {
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Use the find_session tool with query="${description}" to search for sessions matching this description. Show me the matching sessions with their project paths, branches, summaries, and status.`,
          },
        },
      ],
    };
  });
}
