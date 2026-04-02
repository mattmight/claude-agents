export { scanProjectDirs, getProjectsDir } from "./core/scanner.js";
export {
  resolveProjectPath,
  resolveAllProjects,
  buildHistoryPathMap,
  encodePath,
} from "./core/path-resolver.js";
export {
  enumerateProjectSessions,
  enumerateAllSessions,
  discoverSubAgents,
} from "./core/session-enumerator.js";
export {
  parseHistoryBySession,
  streamHistory,
} from "./core/history-parser.js";
export {
  getSessionsDir,
  checkSessionLiveness,
  checkAllSessionsLiveness,
} from "./core/liveness.js";
export {
  planSessionDeletion,
  deleteSession,
  bulkDeleteSessions,
  selectSessionsForBulkDelete,
  pruneHistoryFile,
} from "./core/session-deleter.js";
export type {
  ProjectEntry,
  ScannerOptions,
  SessionsIndex,
  SessionsIndexEntry,
  HistoryEntry,
  Session,
  SubAgent,
  SubAgentMeta,
  HistorySessionData,
  SessionStatus,
  SessionRegistryEntry,
  LivenessResult,
  LivenessOptions,
  DeletionTarget,
  DeletionPlan,
  DeletionResult,
} from "./types.js";
