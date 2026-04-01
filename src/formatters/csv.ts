import type { Session } from "../types.js";

const CSV_HEADERS = [
  "id",
  "project_path",
  "branch",
  "status",
  "updated_at",
  "created_at",
  "message_count",
  "summary",
];

function escapeCsvField(value: string | null): string {
  if (value === null) return "";
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatSessionsCsv(sessions: Session[]): string {
  const lines = [CSV_HEADERS.join(",")];

  for (const s of sessions) {
    const row = [
      s.id,
      escapeCsvField(s.projectPath),
      escapeCsvField(s.branch),
      s.status ?? "unknown",
      s.updatedAt.toISOString(),
      s.createdAt.toISOString(),
      String(s.messageCount),
      escapeCsvField(s.summary),
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}
