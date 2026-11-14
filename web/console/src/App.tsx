// The admin console (M9): sign in with the company identity provider, choose the organisation, and take each
// widget along its track to go-live (the direction contract in .impeccable/surfaces/web-console.md).
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { ApiProblem, call } from "./api";
import { begin, finish, type Provider, signOut, token } from "./signIn";
import { strings as t } from "./strings";
import { type StationId, stations, timeLeft } from "./track";

type Me = { subject: string; role: "platform" | "tenant" | "viewer"; tenant_id: string | null };
type Tenant = { tenant_id: string; name: string };
type Row = { widget_id: string; title: string; version: number | null; unpublished: boolean };
export type WidgetDocument = {
  tenant_id: string;
  public: { title?: string; welcome_message?: string | null; suggested_prompts?: string[]; brand_color?: string };
  allowed_domains: string[];
  sign_in: "anonymous" | "signed_in" | "both";
  agent_profile: string;
  identity?: { provider: string; issuer: string; audience?: string | null; secret?: string | null } | null;
};
type Draft = { revision: number; document: WidgetDocument };

const TENANT = "ucp-console-tenant"; // a platform administrator's last organisation, in this browser
const CHECK = "M5 12.5l4.5 4.5L19 7.5";

export function go(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

function Glyph({ path }: { path: string }) {
  return (
    <svg className="glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

function Gate({ children }: { children: ReactNode }) {
  return (
    <main className="gate">
      <div className="card">{children}</div>
    </main>
  );
}

const remembered = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage refused: nothing is remembered, nothing breaks
  }
};

export function App() {
  const [route, setRoute] = useState(location.pathname);
  const [provider, setProvider] = useState<Provider | "failed" | null>(null);
  const [me, setMe] = useState<Me | "signed-out" | "not-administrator" | "failed" | null>(null);
  const [signInFailed, setSignInFailed] = useState(false);

  useEffect(() => {
    const follow = () => setRoute(location.pathname);
    addEventListener("popstate", follow);
    return () => removeEventListener("popstate", follow);
  }, []);

  const load = useCallback(async () => {
    if (!token()) return setMe("signed-out");
    try {
      setMe(await call<Me>("GET", "/me"));
    } catch (error) {
      const code = error instanceof ApiProblem ? error.problem.code : "";
      setMe(code === "sign_in_required" ? "signed-out" : code === "forbidden" ? "not-administrator" : "failed");
    }
  }, []);

  useEffect(() => {
    fetch("/admin/v1/sign-in")
      .then((reply) => (reply.ok ? reply.json() : Promise.reject(new Error(String(reply.status)))))
      .then(setProvider, () => setProvider("failed"));
  }, []);

  useEffect(() => {
    if (!provider || provider === "failed") return;
    if (location.pathname !== "/signed-in") return void load();
    finish(provider, new URLSearchParams(location.search), location.origin).then(
      (back) => {
        history.replaceState(null, "", back);
        setRoute(back);
        void load();
      },
      () => {
        history.replaceState(null, "", "/");
        setRoute("/");
        setSignInFailed(true);
        setMe("signed-out");
      },
    );
  }, [provider, load]);

  const ended = useCallback(() => setMe("signed-out"), []);

  if (provider === "failed" || me === "failed") {
    return (
      <Gate>
        <p className="problem">{t.unavailable}</p>
        <button type="button" className="secondary" onClick={() => location.reload()}>
          {t.tryAgain}
        </button>
      </Gate>
    );
  }
  if (!provider || me === null) {
    return (
      <Gate>
        <div className="ring" role="status" aria-label={t.loading} />
      </Gate>
    );
  }
  if (me === "signed-out" || me === "not-administrator") {
    return (
      <Gate>
        <p className="mark">
          {t.product} <span>{t.console}</span>
        </p>
        <h1>{t.signInTitle}</h1>
        <p className="note">{t.signInBody}</p>
        {signInFailed && <p className="problem">{t.signInFailed}</p>}
        {me === "not-administrator" && <p className="problem">{t.notAdministrator}</p>}
        <button
          type="button"
          className="primary"
          onClick={() => {
            signOut();
            void begin(provider, route === "/signed-in" ? "/" : route);
          }}
        >
          {t.signIn}
        </button>
      </Gate>
    );
  }
  return <Console me={me} route={route} onEnded={ended} />;
}

function Console({ me, route, onEnded }: { me: Me; route: string; onEnded: () => void }) {
  const [tenants, setTenants] = useState<Tenant[] | null>(null);
  const [tenant, setTenant] = useState<string | null>(me.tenant_id);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  const guard = useCallback(
    (error: unknown) => {
      if (error instanceof ApiProblem && error.problem.code === "sign_in_required") onEnded();
      else setFailed(true);
    },
    [onEnded],
  );

  useEffect(() => {
    // A link to a widget opens in that widget's organisation; otherwise the one chosen last in this browser.
    const linked = /^\/widgets\/([\w-]+)/.exec(location.pathname)?.[1];
    const owner = linked
      ? call<Draft>("GET", `/widgets/${linked}/draft`).then((draft) => draft.document.tenant_id, () => null)
      : Promise.resolve(null);
    Promise.all([call<Tenant[]>("GET", "/tenants"), owner]).then(([found, theirs]) => {
      setTenants(found);
      const kept = theirs ?? remembered(TENANT);
      setTenant((chosen) => chosen ?? found.find((one) => one.tenant_id === kept)?.tenant_id ?? found[0]?.tenant_id ?? null);
    }, guard);
  }, [guard]);

  useEffect(() => {
    if (!tenant) return;
    setRows(null);
    call<Row[]>("GET", `/tenants/${tenant}/widgets`).then(setRows, guard);
  }, [tenant, guard]);

  const [, widgetId, station] = /^\/widgets\/([\w-]+)(?:\/([\w-]+))?/.exec(route) ?? [];
  const row = rows?.find((one) => one.widget_id === widgetId);

  return (
    <>
      <header className="top">
        <p className="mark">
          {t.product} <span>{t.console}</span>
        </p>
        <div className="tenant">
          <span className="hidden">{t.organisation}</span>
          {me.role === "platform" && tenants && tenants.length > 1 ? (
            <select
              aria-label={t.organisation}
              value={tenant ?? ""}
              onChange={(event) => {
                setTenant(event.target.value);
                try {
                  localStorage.setItem(TENANT, event.target.value);
                } catch {
                  // not remembered; the choice still holds for this visit
                }
                go("/");
              }}
            >
              {tenants.map((one) => (
                <option key={one.tenant_id} value={one.tenant_id}>
                  {one.name}
                </option>
              ))}
            </select>
          ) : (
            <output aria-label={t.organisation}>{tenants?.find((one) => one.tenant_id === tenant)?.name ?? ""}</output>
          )}
        </div>
        <p className="who">
          <span>
            {me.subject} · {t.role[me.role]}
          </span>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              signOut();
              onEnded();
            }}
          >
            {t.signOut}
          </button>
        </p>
      </header>
      <div className="shell">
        <nav className="column" aria-label={t.widgets}>
          <h2>{t.widgets}</h2>
          {rows && (
            <ul>
              {rows.map((one) => (
                <li key={one.widget_id}>
                  <a
                    href={`/widgets/${one.widget_id}`}
                    aria-current={one.widget_id === widgetId ? "page" : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      go(`/widgets/${one.widget_id}`);
                    }}
                  >
                    <b>{one.title}</b>
                    <small>{standing(one)}</small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <main className="work">
          {failed ? (
            <p className="problem">{t.unavailable}</p>
          ) : !rows ? (
            <div className="ring" role="status" aria-label={t.loading} />
          ) : row ? (
            <Widget key={row.widget_id} row={row} open={station as StationId | undefined} onProblem={guard} />
          ) : (
            <div className="empty">
              <h1>{rows.length ? t.chooseWidget : t.noWidgets}</h1>
              {!rows.length && <p className="note">{t.firstWidget}</p>}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function standing(row: Row): string {
  if (row.version === null) return t.notLive;
  return row.unpublished ? `${t.live(row.version)} · ${t.unpublished}` : t.live(row.version);
}

function Widget({ row, open, onProblem }: { row: Row; open?: StationId; onProblem: (error: unknown) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    call<Draft>("GET", `/widgets/${row.widget_id}/draft`).then(setDraft, onProblem);
  }, [row.widget_id, onProblem]);

  if (!draft) return <div className="ring" role="status" aria-label={t.loading} />;
  const document = draft.document;
  const track = stations({
    set: ["agent", "sites", "sign-in", "look"],
    version: row.version,
    unpublished: row.unpublished || row.version === null,
    signedIn: document.sign_in !== "anonymous",
  });
  const shown = open && track.some((one) => one.id === open) ? open : (track.find((one) => one.state === "now")?.id ?? "live");
  const left = timeLeft(track);

  return (
    <>
      <h1>{row.title}</h1>
      <p className="sub">
        {t.sites(document.allowed_domains.length)} · {who(document)}
      </p>
      <section className="journey" aria-label={t.station.live}>
        <p className="sign">{row.version !== null && !left ? standing(row) : t.timeLeft(left)}</p>
        <ol className="track">
          {track.map((one, index) => (
            <li key={one.id} className={`station ${one.state}`}>
              <button
                type="button"
                className={one.id === shown ? "open" : undefined}
                aria-current={one.state === "now" ? "step" : undefined}
                aria-pressed={one.id === shown}
                onClick={() => go(`/widgets/${row.widget_id}/${one.id}`)}
              >
                <span className="dot">{one.state === "done" ? <Glyph path={CHECK} /> : index + 1}</span>
                <span className="name">{t.station[one.id]}</span>
                <small>{one.state === "done" ? t.done : t.minutes(one.minutes)}</small>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <section className="card stop" aria-labelledby="stop-title">
        <header>
          <h2 id="stop-title">{t.station[shown]}</h2>
          <p>{t.stationIntro[shown]}</p>
        </header>
        <Facts station={shown} row={row} document={document} />
      </section>
    </>
  );
}

function who(document: WidgetDocument): string {
  return document.sign_in === "anonymous" ? t.anyone : document.sign_in === "signed_in" ? t.signedInOnly : t.both;
}

/** What a station holds now, as read. Each station's editor replaces this as it is built. */
function Facts({ station, row, document }: { station: StationId; row: Row; document: WidgetDocument }) {
  const look = document.public;
  const facts: [string, ReactNode][] = {
    agent: [[t.station.agent, t.answersFrom(document.agent_profile)]],
    sites: [[t.station.sites, <ul key="sites">{document.allowed_domains.map((site) => <li key={site}>{site}</li>)}</ul>]],
    "sign-in": [
      [t.station["sign-in"], who(document)],
      ...(document.identity
        ? [["", document.identity.secret ? t.sharedSecret(document.identity.secret) : t.provider(document.identity.issuer)] as [string, ReactNode]]
        : []),
    ],
    look: [
      [t.title, look.title],
      [t.welcome, look.welcome_message ?? ""],
      [t.questions, (look.suggested_prompts ?? []).join(" · ")],
      [t.colour, <span key="colour"><span className="swatch" style={{ background: look.brand_color }} />{look.brand_color}</span>],
    ],
    install: [[t.widgetId, <code key="id">{row.widget_id}</code>]],
    live: [[t.station.live, standing(row)]],
  }[station] as [string, ReactNode][];
  return (
    <dl className="facts">
      {facts.map(([term, detail], index) => (
        <div key={index} className="fact">
          <dt>{term}</dt>
          <dd>{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
