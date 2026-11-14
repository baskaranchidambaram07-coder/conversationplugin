import { expect, test } from "@playwright/test";

// M9: the admin console as hosted in the dev environment, on its own CloudFront address, signing administrators in
// with the Cognito user pool (infra/aws/dev/console.tf). deployed.config.ts names the address; elsewhere this is skipped.
const CONSOLE = process.env.UCP_CONSOLE_URL;

test.skip(!CONSOLE, "needs the deployed environment: npm run e2e:deployed");

test("the hosted console is served behind Cognito's sign-in, fresh after each release, and cannot be framed", async ({
  page,
  request,
}) => {
  const home = await request.get(`${CONSOLE}/widgets`);
  expect(home.status()).toBe(200);
  expect(home.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(home.headers()["cache-control"]).toBe("no-cache"); // a release's new files are found at once
  expect((await request.get(`${CONSOLE}/admin/v1/me`)).status()).toBe(401);

  const signIn = await (await request.get(`${CONSOLE}/admin/v1/sign-in`)).json();
  const cognito = /^https:\/\/ucp-dev-admins-[0-9a-f]+\.auth\.us-east-1\.amazoncognito\.com\//;
  expect(signIn.authorization_endpoint).toMatch(cognito);
  expect(signIn.token_endpoint).toMatch(cognito);
  expect(home.headers()["content-security-policy"]).toContain(new URL(signIn.token_endpoint).origin);

  await page.goto(`${CONSOLE}/widgets`);
  await expect(page.getByRole("heading", { name: "Sign in to set up your assistant" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(cognito); // Cognito's own sign-in page, with PKCE and this tab's state
  const asked = new URL(page.url()).searchParams;
  expect(asked.get("client_id")).toBe(signIn.client_id);
  expect(asked.get("code_challenge_method")).toBe("S256");
  expect(asked.get("redirect_uri")).toBe(`${CONSOLE}/signed-in`);
});
