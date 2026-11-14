// The editors of the track's first three stations (M9-T2): the agent connection, the allowed sites, and sign-in.
// Each edits a copy of the widget's document; the page around it saves (an existing widget) or carries it to the
// next station (a new one). Secrets go straight to the admin API, sealed there, and are never shown again; a new
// shared secret is shown once, when made.
import { useEffect, useId, useState } from "react";

import { ApiProblem, call } from "./api";
import { strings as t } from "./strings";

export type Identity = { provider: string; issuer: string; audience?: string | null; secret?: string | null };
type Secret = { kind: "profile" | "host"; name: string; updated_at: string; updated_by: string };
type Made = { name: string; key_id: string; secret: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      {children(id)}
    </div>
  );
}

export function Faults({ faults }: { faults: string[] }) {
  if (!faults.length) return null;
  return (
    <div className="faults" role="alert">
      <p>{t.faultsTitle}</p>
      <ul>
        {faults.map((fault) => (
          <li key={fault}>{fault.replace(/^w_[\w-]+: /, "")}</li>
        ))}
      </ul>
    </div>
  );
}

/** The organisation's connections and shared secrets, by name only. */
function useSecrets(tenant: string, onProblem: (error: unknown) => void) {
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const reload = () => call<Secret[]>("GET", `/tenants/${tenant}/secrets`).then(setSecrets, onProblem);
  useEffect(() => void reload(), [tenant]); // once per organisation; reload() is called again after each change
  return [secrets, reload] as const;
}

const NEW_CONNECTION = {
  name: "",
  base_url: "",
  tenant: "",
  workspace_id: "",
  agent_version_id: "",
  api_key: "",
  username: "",
  password: "",
};

export function AgentEditor(props: {
  tenant: string;
  value: string;
  onChange: (profile: string) => void;
  readOnly: boolean;
  onProblem: (error: unknown) => void;
}) {
  const { tenant, value, onChange, readOnly, onProblem } = props;
  const [secrets, reload] = useSecrets(tenant, onProblem);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(NEW_CONNECTION);
  const [faults, setFaults] = useState<string[]>([]);
  const connections = (secrets ?? []).filter((secret) => secret.kind === "profile");

  async function test(name: string) {
    setTested((shown) => ({ ...shown, [name]: t.testing }));
    try {
      const result = await call<{ connected: boolean; advice?: string }>("POST", `/tenants/${tenant}/agent-profiles/${name}/test`);
      setTested((shown) => ({ ...shown, [name]: result.connected ? t.connected : t.notConnected(result.advice ?? "") }));
    } catch (error) {
      setTested((shown) => ({ ...shown, [name]: "" }));
      onProblem(error);
    }
  }

  async function save() {
    const { name, ...profile } = draft;
    const missing = Object.entries(draft).filter(([, given]) => !given.trim()).map(([field]) => t.connectionField[field] ?? field);
    if (!ID.test(name)) missing.unshift(t.connectionNameRule);
    if (missing.length) return setFaults(missing.map((field) => t.required(field)));
    try {
      await call("PUT", `/tenants/${tenant}/agent-profiles/${name}`, profile);
      setDraft(NEW_CONNECTION);
      setAdding(false);
      setFaults([]);
      await reload();
      onChange(name);
      void test(name);
    } catch (error) {
      if (error instanceof ApiProblem && error.problem.code === "invalid_request") setFaults([t.connectionRefused]);
      else onProblem(error);
    }
  }

  return (
    <div className="editor">
      <fieldset disabled={readOnly}>
        <legend>{t.chooseConnection}</legend>
        {secrets && !connections.length && <p className="note">{t.noConnections}</p>}
        <ul className="choices">
          {connections.map((connection) => (
            <li key={connection.name} className={value === connection.name ? "chosen" : undefined}>
              <label>
                <input type="radio" name="connection" checked={value === connection.name} onChange={() => onChange(connection.name)} />
                <span>
                  <b>{connection.name}</b>
                  <small>{t.setBy(connection.updated_by, connection.updated_at)}</small>
                </span>
              </label>
              <button type="button" className="quiet" onClick={() => void test(connection.name)}>
                {t.test}
              </button>
              <output aria-live="polite" className={tested[connection.name] === t.connected ? "good" : undefined}>
                {tested[connection.name]}
              </output>
            </li>
          ))}
          {value && !connections.some((connection) => connection.name === value) && (
            <li className="chosen">
              <label>
                <input type="radio" name="connection" checked readOnly />
                <span>
                  <b>{value}</b>
                  <small>{t.platformConnection}</small>
                </span>
              </label>
            </li>
          )}
        </ul>
      </fieldset>
      {!readOnly &&
        (adding ? (
          <div className="add">
            <h3>{t.addConnection}</h3>
            <p className="hint">{t.connectionHint}</p>
            <div className="grid">
              {Object.keys(NEW_CONNECTION).map((field) => (
                <Field key={field} label={t.connectionField[field] ?? field}>
                  {(id) => (
                    <input
                      id={id}
                      type={field === "password" || field === "api_key" ? "password" : field === "base_url" ? "url" : "text"}
                      autoComplete="off"
                      spellCheck={false}
                      value={draft[field as keyof typeof NEW_CONNECTION]}
                      onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                    />
                  )}
                </Field>
              ))}
            </div>
            <Faults faults={faults} />
            <div className="actions">
              <button type="button" className="secondary" onClick={() => void save()}>
                {t.saveConnection}
              </button>
              <button type="button" className="quiet" onClick={() => setAdding(false)}>
                {t.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            {t.addConnection}
          </button>
        ))}
    </div>
  );
}

export function SitesEditor({ value, onChange, readOnly }: { value: string[]; onChange: (sites: string[]) => void; readOnly: boolean }) {
  const [site, setSite] = useState("");
  const [wrong, setWrong] = useState("");

  function add() {
    const given = site.trim().replace(/\/+$/, "").toLowerCase();
    if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/.test(given)) return setWrong(t.siteRule);
    if (!value.includes(given)) onChange([...value, given]);
    setSite("");
    setWrong("");
  }

  return (
    <div className="editor">
      <ul className="sites">
        {value.map((one) => (
          <li key={one}>
            <code>{one}</code>
            {!readOnly && (
              <button type="button" className="quiet" aria-label={t.removeSite(one)} onClick={() => onChange(value.filter((other) => other !== one))}>
                {t.remove}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!value.length && <p className="note">{t.noSites}</p>}
      {!readOnly && (
        <Field label={t.addSite} hint={t.siteHint}>
          {(id) => (
            <div className="inline">
              <input
                id={id}
                type="url"
                inputMode="url"
                placeholder="https://www.example.ac.uk"
                spellCheck={false}
                value={site}
                aria-invalid={Boolean(wrong)}
                aria-describedby={wrong ? `${id}-wrong` : undefined}
                onChange={(event) => setSite(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    add();
                  }
                }}
              />
              <button type="button" className="secondary" onClick={add}>
                {t.add}
              </button>
              {wrong && (
                <p className="problem" id={`${id}-wrong`}>
                  {wrong}
                </p>
              )}
            </div>
          )}
        </Field>
      )}
    </div>
  );
}

type SignIn = "anonymous" | "signed_in" | "both";

export function SignInEditor(props: {
  tenant: string;
  signIn: SignIn;
  identity: Identity | null;
  onChange: (signIn: SignIn, identity: Identity | null) => void;
  readOnly: boolean;
  onProblem: (error: unknown) => void;
}) {
  const { tenant, signIn, identity, onChange, readOnly, onProblem } = props;
  const [secrets, reload] = useSecrets(tenant, onProblem);
  const [made, setMade] = useState<Made | null>(null);
  const method = identity && !identity.secret ? "provider" : "portal";
  const secretName = identity?.secret ?? "portal";
  const existing = (secrets ?? []).find((secret) => secret.kind === "host" && secret.name === secretName);

  async function makeSecret() {
    try {
      setMade(await call<Made>("POST", `/tenants/${tenant}/host-secrets/${secretName}`));
      await reload();
    } catch (error) {
      onProblem(error);
    }
  }

  const portal = (changes: Partial<Identity>) =>
    onChange(signIn, { provider: "portal", issuer: identity?.issuer ?? "", secret: secretName, ...changes, audience: null });

  return (
    <div className="editor">
      <fieldset disabled={readOnly}>
        <legend>{t.whoMayChat}</legend>
        <ul className="choices">
          {(["anonymous", "signed_in", "both"] as const).map((mode) => (
            <li key={mode} className={signIn === mode ? "chosen" : undefined}>
              <label>
                <input
                  type="radio"
                  name="sign-in"
                  checked={signIn === mode}
                  onChange={() => onChange(mode, mode === "anonymous" ? null : identity ?? { provider: "portal", issuer: "", secret: "portal" })}
                />
                <span>
                  <b>{t.mode[mode]}</b>
                  <small>{t.modeHint[mode]}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {signIn !== "anonymous" && identity && (
        <>
          <fieldset disabled={readOnly}>
            <legend>{t.howSignedIn}</legend>
            <ul className="choices">
              <li className={method === "portal" ? "chosen" : undefined}>
                <label>
                  <input type="radio" name="method" checked={method === "portal"} onChange={() => portal({})} />
                  <span>
                    <b>{t.method.portal}</b>
                    <small>{t.methodHint.portal}</small>
                  </span>
                </label>
              </li>
              <li className={method === "provider" ? "chosen" : undefined}>
                <label>
                  <input
                    type="radio"
                    name="method"
                    checked={method === "provider"}
                    onChange={() => onChange(signIn, { provider: "sso", issuer: "", audience: "", secret: null })}
                  />
                  <span>
                    <b>{t.method.provider}</b>
                    <small>{t.methodHint.provider}</small>
                  </span>
                </label>
              </li>
            </ul>
          </fieldset>
          {method === "portal" ? (
            <div className="grid">
              <Field label={t.portalName} hint={t.portalNameHint}>
                {(id) => (
                  <input id={id} type="text" spellCheck={false} readOnly={readOnly} value={identity.issuer} onChange={(event) => portal({ issuer: event.target.value })} />
                )}
              </Field>
              <div className="field">
                <p className="label">{t.secretLabel}</p>
                <p className="hint">{existing ? t.secretExists(secretName, existing.updated_at) : t.secretMissing}</p>
                {!readOnly && (
                  <button type="button" className="secondary" onClick={() => void makeSecret()}>
                    {existing ? t.rotateSecret : t.makeSecret}
                  </button>
                )}
              </div>
              {made && (
                <div className="once" role="status">
                  <p>
                    <b>{t.secretOnce}</b> {t.secretOnceHint}
                  </p>
                  <code>
                    {made.key_id}:{made.secret}
                  </code>
                  <button type="button" className="quiet" onClick={() => void navigator.clipboard?.writeText(`${made.key_id}:${made.secret}`)}>
                    {t.copy}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="grid">
              <Field label={t.issuer} hint={t.issuerHint}>
                {(id) => (
                  <input
                    id={id}
                    type="url"
                    spellCheck={false}
                    readOnly={readOnly}
                    value={identity.issuer}
                    onChange={(event) => onChange(signIn, { ...identity, issuer: event.target.value })}
                  />
                )}
              </Field>
              <Field label={t.audience} hint={t.audienceHint}>
                {(id) => (
                  <input
                    id={id}
                    type="text"
                    spellCheck={false}
                    readOnly={readOnly}
                    value={identity.audience ?? ""}
                    onChange={(event) => onChange(signIn, { ...identity, audience: event.target.value || null })}
                  />
                )}
              </Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}
