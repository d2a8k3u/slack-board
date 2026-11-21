export const RETRY_AFTER_FAILURE_MS = 30_000;

export const nextSyncAt = (now: number, result: "synced" | "failed", syncMs: number): number =>
  now + (result === "failed" ? Math.min(RETRY_AFTER_FAILURE_MS, syncMs) : syncMs);
