// Signing administrators in with the company identity provider (M9-T1): OpenID Connect's authorization-code flow
// with PKCE, as a browser app runs it. No client secret exists; the code the provider returns is bound to a
// verifier only this tab holds. The provider's ID token (made for this console, the admin API's audience) is kept
// in this tab's session storage, so it ends with the tab, and is treated as gone a minute before it expires.

export type Provider = { client_id: string; authorization_endpoint: string; token_endpoint: string };

const SESSION = "ucp-console-token";
const PENDING = "ucp-console-pending";
const EARLY = 60; // seconds before expiry when a token stops being used

const base64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const random = (size: number) => base64url(crypto.getRandomValues(new Uint8Array(size)));

export const returnAddress = (origin: string) => `${origin}/signed-in`;

/** Sends the administrator to the provider, to come back to `back` once signed in. */
export async function begin(provider: Provider, back: string, here: Location = location): Promise<void> {
  const verifier = random(32);
  const state = random(16);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state, back }));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const address = new URL(provider.authorization_endpoint);
  address.search = new URLSearchParams({
    response_type: "code",
    client_id: provider.client_id,
    redirect_uri: returnAddress(here.origin),
    scope: "openid",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();
  here.assign(address.toString());
}

/** On the return address: exchanges the code for the ID token and keeps it. Returns where the administrator was. */
export async function finish(provider: Provider, query: URLSearchParams, origin: string): Promise<string> {
  const pending = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as
    | { verifier: string; state: string; back: string }
    | null;
  sessionStorage.removeItem(PENDING);
  const code = query.get("code");
  if (!pending || !code || query.get("state") !== pending.state) throw new Error("The sign-in did not complete.");
  const reply = await fetch(provider.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: returnAddress(origin),
      client_id: provider.client_id,
      code_verifier: pending.verifier,
    }),
  });
  const token = reply.ok ? ((await reply.json()) as { id_token?: unknown }).id_token : undefined;
  if (typeof token !== "string") throw new Error("The sign-in did not complete.");
  sessionStorage.setItem(SESSION, token);
  return pending.back.startsWith("/") && !pending.back.startsWith("//") ? pending.back : "/";
}

function claims(token: string): { exp?: number } | null {
  try {
    const part = token.split(".")[1] ?? "";
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** The kept token, or null when there is none or it is about to expire: then the administrator signs in again. */
export function token(now = Date.now() / 1000): string | null {
  const kept = sessionStorage.getItem(SESSION);
  const exp = kept ? claims(kept)?.exp : undefined;
  if (!kept || typeof exp !== "number" || exp - EARLY <= now) {
    sessionStorage.removeItem(SESSION);
    return null;
  }
  return kept;
}

export function signOut(): void {
  sessionStorage.removeItem(SESSION);
}
