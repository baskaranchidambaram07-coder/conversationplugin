// The Install station (M9-T5): what the customer's web team adds to their pages, filled in for this widget, and a
// check of a page of their site. The snippets are the College guide's own (docs/college-sandbox-guide.md); the
// token-signing code is the tested examples (examples/token-signing), shown as they are.
import { useId, useState } from "react";

import dotnet from "../../../examples/token-signing/dotnet/Program.cs?raw";
import go from "../../../examples/token-signing/go/sign.go?raw";
import java from "../../../examples/token-signing/java/Sign.java?raw";
import node from "../../../examples/token-signing/node/sign.mjs?raw";
import php from "../../../examples/token-signing/php/sign.php?raw";
import python from "../../../examples/token-signing/python/sign.py?raw";
import { call } from "./api";
import type { WidgetDocument } from "./App";
import { Field } from "./editors";
import { strings as t } from "./strings";

const LANGUAGES = { Node: node, Python: python, Java: java, ".NET": dotnet, Go: go, PHP: php };

type Check = { check: "page" | "script" | "policy"; ok: boolean; detail: string | null };

function Snippet({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="snippet">
      <figcaption>
        <span>{label}</span>
        <button
          type="button"
          className="quiet"
          onClick={() =>
            void navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? t.copied : t.copy}
        </button>
      </figcaption>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}

const queue = `window.UCP =
  window.UCP ||
  function () {
    (UCP.q = UCP.q || []).push(arguments);
  };
`;

function pageScript(widgetId: string, method: "portal" | "provider" | null, target: boolean): string {
  const token =
    method === "portal"
      ? `
  getToken: () =>
    fetch("/widget-token", { credentials: "same-origin" }).then((reply) =>
      reply.ok ? reply.text() : Promise.reject(new Error(\`no token: \${reply.status}\`)),
    ),`
      : method === "provider"
        ? `
  getToken: () => yourSignIn.idToken(), // the visitor's ID token from your sign-in library`
        : "";
  return `${queue}
UCP("mount", {
  widgetId: "${widgetId}",${target ? `\n  target: "#assistant",` : ""}${token}
});
`;
}

export function Install(props: { widgetId: string; gateway: string | null; document: WidgetDocument }) {
  const { widgetId, gateway, document } = props;
  const [page, setPage] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [language, setLanguage] = useState<keyof typeof LANGUAGES>("Node");
  const tabs = useId();
  if (!gateway) return <p className="problem">{t.noGateway}</p>;

  const loader = `<script async src="${gateway}/loader.js"></script>`;
  const signedIn = document.sign_in !== "anonymous" && document.identity;
  const method = signedIn ? (document.identity?.secret ? "portal" : "provider") : null;
  const tag = method ? `<script src="assistant-setup.js"></script>\n${loader}` : `<script async src="${gateway}/loader.js" data-widget-id="${widgetId}"></script>`;

  async function check() {
    setChecking(true);
    try {
      setChecks((await call<{ checks: Check[] }>("POST", `/widgets/${widgetId}/install-check`, { page: page.trim() })).checks);
    } catch {
      setChecks([{ check: "page", ok: false, detail: t.checkFailed }]);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="editor install">
      <section>
        <h3>{t.everyPage}</h3>
        <p className="hint">{method ? t.everyPageSignedIn : t.everyPageHint}</p>
        <Snippet label={t.htmlLabel} code={tag} />
        {method && <Snippet label="assistant-setup.js" code={pageScript(widgetId, method, false)} />}
      </section>
      {method === "portal" && (
        <section>
          <h3>{t.endpoint}</h3>
          <p className="hint">{t.endpointHint}</p>
          <Snippet
            label={t.endpointSettings}
            code={`UCP_ISSUER=${document.identity?.issuer ?? ""}\nUCP_WIDGET_ID=${widgetId}\nUCP_SECRET_ID=<the ID before the colon in the shared secret>\nUCP_WIDGET_SECRET=<the rest of the shared secret>`}
          />
          <div className="tabs" role="tablist" aria-label={t.languages}>
            {Object.keys(LANGUAGES).map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`${tabs}-${name}`}
                aria-selected={language === name}
                aria-controls={`${tabs}-panel`}
                className="quiet"
                onClick={() => setLanguage(name as keyof typeof LANGUAGES)}
              >
                {name}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${tabs}-panel`} aria-labelledby={`${tabs}-${language}`}>
            <Snippet label={t.endpointCode(language)} code={LANGUAGES[language]} />
          </div>
        </section>
      )}
      <section>
        <h3>{t.inPage}</h3>
        <p className="hint">{t.inPageHint}</p>
        <Snippet label={t.htmlLabel} code={`<main id="assistant"></main>\n<script src="assistant-setup.js"></script>\n${loader}`} />
        <Snippet label="assistant-setup.js" code={pageScript(widgetId, method, true)} />
      </section>
      <section>
        <h3>{t.policyTitle}</h3>
        <p className="hint">{t.policyHint}</p>
        <Snippet label={t.policyLabel} code={`script-src ${gateway}\nframe-src ${gateway}\nconnect-src ${gateway}`} />
      </section>
      <section>
        <h3>{t.checkTitle}</h3>
        <p className="hint">{t.checkHint}</p>
        <Field label={t.pageAddress}>
          {(id) => (
            <div className="inline">
              <input
                id={id}
                type="url"
                inputMode="url"
                spellCheck={false}
                placeholder={document.allowed_domains[0] ? `${document.allowed_domains[0].replace("*.", "www.")}/` : "https://"}
                value={page}
                onChange={(event) => setPage(event.target.value)}
              />
              <button type="button" className="secondary" disabled={!page.trim() || checking} onClick={() => void check()}>
                {checking ? t.checking : t.check}
              </button>
            </div>
          )}
        </Field>
        {checks && (
          <ul className="checks" aria-live="polite">
            {checks.map((one) => (
              <li key={one.check} className={one.ok ? "good" : "bad"}>
                {t.checkName[one.check]} <b>{one.ok ? t.passed : t.failed}</b>
                {one.detail && (one.check !== "page" || !one.ok) ? ` — ${one.detail}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
