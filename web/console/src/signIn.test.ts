import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ApiProblem, call } from "./api";
import { begin, finish, type Provider, signOut, token } from "./signIn";

const PROVIDER: Provider = {
  client_id: "ucp-console",
  authorization_endpoint: "https://login.example.org/oauth2/authorize",
  token_endpoint: "https://login.example.org/oauth2/token",
};
const ORIGIN = "https://console.example.org";
const encode = (claims: object) => btoa(JSON.stringify(claims)).replace(/=+$/, "");
const idToken = (exp: number) => `${encode({ alg: "RS256" })}.${encode({ sub: "ana", exp })}.signature`;

let assigned = "";
const here = { origin: ORIGIN, assign: (to: string) => void (assigned = to) } as unknown as Location;

beforeEach(() => {
  sessionStorage.clear();
  assigned = "";
});
afterEach(() => vi.unstubAllGlobals());

async function signIn(exp = Date.now() / 1000 + 3600) {
  await begin(PROVIDER, "/widgets/w_1", here);
  const sent = new URL(assigned).searchParams;
  const fetched = vi.fn(async () => Response.json({ id_token: idToken(exp) }));
  vi.stubGlobal("fetch", fetched);
  const back = await finish(PROVIDER, new URLSearchParams({ code: "c-1", state: sent.get("state")! }), ORIGIN);
  return { sent, fetched, back };
}

test("sign-in goes to the provider with a PKCE challenge, and comes back with the verifier only this tab holds", async () => {
  const { sent, fetched, back } = await signIn();

  expect(assigned.startsWith(PROVIDER.authorization_endpoint)).toBe(true);
  expect(Object.fromEntries(sent)).toMatchObject({
    response_type: "code",
    client_id: "ucp-console",
    redirect_uri: `${ORIGIN}/signed-in`,
    scope: "openid",
    code_challenge_method: "S256",
  });
  const body = new URLSearchParams(String((fetched.mock.calls[0] as unknown as [string, RequestInit])[1].body));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.get("code_verifier")!));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(challenge).toBe(sent.get("code_challenge"));
  expect(Object.fromEntries(body)).toMatchObject({ grant_type: "authorization_code", code: "c-1", client_id: "ucp-console" });
  expect(back).toBe("/widgets/w_1");
  expect(token()).toMatch(/\.signature$/);
});

test("a return that this tab did not start, or with the wrong state, signs no one in", async () => {
  await expect(finish(PROVIDER, new URLSearchParams({ code: "c-1", state: "x" }), ORIGIN)).rejects.toThrow();
  await begin(PROVIDER, "/", here);
  await expect(finish(PROVIDER, new URLSearchParams({ code: "c-1", state: "forged" }), ORIGIN)).rejects.toThrow();
  expect(token()).toBeNull();
});

test("a session ends a minute before the token expires, and on signing out", async () => {
  await signIn(Date.now() / 1000 + 30);
  expect(token()).toBeNull();

  await signIn();
  signOut();
  expect(token()).toBeNull();
});

test("only a path on this console is a place to come back to", async () => {
  await begin(PROVIDER, "//evil.example/", here);
  const state = new URL(assigned).searchParams.get("state")!;
  vi.stubGlobal("fetch", async () => Response.json({ id_token: idToken(Date.now() / 1000 + 3600) }));

  expect(await finish(PROVIDER, new URLSearchParams({ code: "c", state }), ORIGIN)).toBe("/");
});

test("the API carries the token, and a refusal comes back as the API's problem with its faults", async () => {
  await signIn();
  const fetched = vi.fn(async () =>
    Response.json({ code: "invalid_request", message: "The request is not valid.", reference: "r_1", faults: ["w: title"] }, { status: 400 }),
  );
  vi.stubGlobal("fetch", fetched);

  const refused = await call("PUT", "/widgets/w_1/draft", { revision: 0 }).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(ApiProblem);
  expect((refused as ApiProblem).problem.faults).toEqual(["w: title"]);
  const [path, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/admin/v1/widgets/w_1/draft");
  expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer .+\.signature$/);

  signOut();
  await expect(call("GET", "/me")).rejects.toMatchObject({ problem: { code: "sign_in_required" } });
});
