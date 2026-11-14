// The admin API (/admin/v1, ucp.admin.app), on the console's own address. Every call carries the signed-in
// administrator's token; a refusal comes back as the API's problem, with every fault in a draft when there are any.

import { token } from "./signIn";

export type Problem = { code: string; message: string; reference: string; faults?: string[] };

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly problem: Problem,
  ) {
    super(problem.message);
  }
}

/** Calls the admin API. Throws ApiProblem for any refusal; `sign_in_required` when the session has ended. */
export async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const signed = token();
  if (!signed) throw new ApiProblem(401, { code: "sign_in_required", message: "Sign in to continue.", reference: "" });
  const reply = await fetch(`/admin/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${signed}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (reply.status === 204) return undefined as T;
  const answer = await reply.json().catch(() => null);
  if (!reply.ok) {
    const problem = answer && typeof answer.code === "string" ? (answer as Problem) : null;
    throw new ApiProblem(reply.status, problem ?? { code: "internal_error", message: "Something went wrong.", reference: "" });
  }
  return answer as T;
}
