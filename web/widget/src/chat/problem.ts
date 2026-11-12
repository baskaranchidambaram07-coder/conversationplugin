// Turns any failure into one of the error states the visitor can understand (M2-T12), with the reference ID
// support needs. Never shows the gateway's own wording, so nothing from PF can reach the screen (R13).
import type { ProblemKind } from "../strings";
import { Failure } from "./api";

export type Problem = { kind: ProblemKind; reference: string | null; retryable: boolean };

const BY_CODE: Partial<Record<string, ProblemKind>> = {
  rate_limited: "busy",
  session_expired: "expired",
  site_not_allowed: "notAllowed",
  forbidden: "notAllowed",
  assistant_unavailable: "unavailable",
  internal_error: "unavailable",
};

export function problemOf(error: unknown, online = navigator.onLine): Problem {
  if (!(error instanceof Failure)) return { kind: "failed", reference: null, retryable: true };
  if (error.status === 0) return { kind: online ? "unavailable" : "offline", reference: null, retryable: true };
  const kind = BY_CODE[error.error?.code ?? ""] ?? (error.status >= 500 ? "unavailable" : "failed");
  return { kind, reference: error.error?.reference ?? null, retryable: kind !== "expired" && kind !== "notAllowed" };
}
