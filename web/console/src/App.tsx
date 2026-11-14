// The admin console (M9): sign in with the company identity provider, choose the organisation, and take each
// widget along its track to go-live (the direction contract in .impeccable/surfaces/web-console.md).
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

import { ApiProblem, call } from "./api";
import { AgentEditor, Faults, SignInEditor, SitesEditor } from "./editors";
import { Install } from "./install";
import { type Look, LookEditor, Preview } from "./look";
import { begin, finish, type Provider, signOut, token } from "./signIn";
import { strings as t } from "./strings";
import { type Station, type StationId, stations, timeLeft } from "./track";

type Me = { subject: string; role: "platform" | "tenant" | "viewer"; tenant_id: string | null; gateway: string | null };
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
const PLUS = "M12 5v14M5 12h14";

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
  const [failed, setFailed] = useState<string | null>(null);

  const guard = useCallback(
    (error: unknown) => {
      if (error instanceof ApiProblem && error.problem.code === "sign_in_required") onEnded();
      // The API's own words for a refusal it explains (too many requests); otherwise the plain unavailable note.
      else setFailed(error instanceof ApiProblem && error.problem.code === "rate_limited" ? error.problem.message : t.unavailable);
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

  const refresh = useCallback(() => {
    if (tenant) void call<Row[]>("GET", `/tenants/${tenant}/widgets`).then(setRows, guard);
  }, [tenant, guard]);

  useEffect(() => {
    setRows(null);
    refresh();
  }, [refresh]);

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
          {me.role !== "viewer" && tenant && (
            <a
              className="secondary"
              href="/widgets/new"
              aria-current={widgetId === "new" ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go("/widgets/new");
              }}
            >
              <Glyph path={PLUS} />
              {t.newWidget}
            </a>
          )}
        </nav>
        <main className="work">
          {failed ? (
            <p className="problem" role="alert">
              {failed}
            </p>
          ) : !rows ? (
            <div className="ring" role="status" aria-label={t.loading} />
          ) : widgetId === "new" && tenant && me.role !== "viewer" ? (
            <NewWidget
              key={tenant}
              tenant={tenant}
              open={station as StationId | undefined}
              onCreated={(id) => {
                refresh();
                go(`/widgets/${id}/look`);
              }}
              onProblem={guard}
            />
          ) : row && tenant ? (
            <Widget
              key={row.widget_id}
              row={row}
              tenant={tenant}
              gateway={me.gateway}
              readOnly={me.role === "viewer"}
              open={station as StationId | undefined}
              onSaved={refresh}
              onProblem={guard}
            />
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

/** The six stations, each signed with its minutes. A station not yet reachable is shown but cannot be opened. */
function Track(props: {
  track: Station[];
  shown: StationId;
  sign: string;
  reachable: (id: StationId) => boolean;
  onOpen: (id: StationId) => void;
}) {
  const { track, shown, sign, reachable, onOpen } = props;
  return (
    <section className="journey" aria-label={t.station.live}>
      <p className="sign">{sign}</p>
      <ol className="track">
        {track.map((one, index) => (
          <li key={one.id} className={`station ${one.state}`}>
            <button
              type="button"
              className={one.id === shown ? "open" : undefined}
              aria-current={one.state === "now" ? "step" : undefined}
              aria-pressed={one.id === shown}
              aria-disabled={!reachable(one.id) || undefined}
              title={reachable(one.id) ? undefined : t.notYet}
              onClick={() => reachable(one.id) && onOpen(one.id)}
            >
              <span className="dot">{one.state === "done" ? <Glyph path={CHECK} /> : index + 1}</span>
              <span className="name">{t.station[one.id]}</span>
              <small>{one.state === "done" ? t.done : t.minutes(one.minutes)}</small>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

const EDITED: StationId[] = ["agent", "sites", "sign-in", "look"];

/** The editor of one of the first three stations, over a copy of the document. */
function StationEditor(props: {
  station: StationId;
  widgetId: string;
  tenant: string;
  document: WidgetDocument;
  onChange: (document: WidgetDocument) => void;
  readOnly: boolean;
  onProblem: (error: unknown) => void;
}) {
  const { station, widgetId, tenant, document, onChange, readOnly, onProblem } = props;
  if (station === "agent") {
    return (
      <AgentEditor
        tenant={tenant}
        value={document.agent_profile}
        onChange={(agent_profile) => onChange({ ...document, agent_profile })}
        readOnly={readOnly}
        onProblem={onProblem}
      />
    );
  }
  if (station === "look") {
    return (
      <div className="beside">
        <LookEditor
          value={document.public as Look}
          signedIn={document.sign_in !== "anonymous"}
          onChange={(look) => onChange({ ...document, public: look })}
          readOnly={readOnly}
        />
        <Preview look={document.public as Look} widgetId={widgetId} />
      </div>
    );
  }
  if (station === "sites") {
    return (
      <SitesEditor value={document.allowed_domains} onChange={(allowed_domains) => onChange({ ...document, allowed_domains })} readOnly={readOnly} />
    );
  }
  return (
    <SignInEditor
      tenant={tenant}
      signIn={document.sign_in}
      identity={document.identity ?? null}
      onChange={(sign_in, identity) => onChange({ ...document, sign_in, identity })}
      readOnly={readOnly}
      onProblem={onProblem}
    />
  );
}

/** What stops a station's settings from going on: checked here first, then again by the API. */
function missing(station: StationId, document: WidgetDocument): string | null {
  if (station === "agent") return document.agent_profile ? null : t.agentMissing;
  if (station === "sites") return document.allowed_domains.length ? null : t.sitesMissing;
  if (station === "look") return document.public.title?.trim() ? null : t.titleMissing;
  if (station === "sign-in" && document.sign_in !== "anonymous") {
    const identity = document.identity;
    return identity?.issuer.trim() ? null : t.signInMissing;
  }
  return null;
}

/** A save's refusal, in the console's words: every fault in the draft, or someone else's change first. */
function refusal(error: unknown): { faults: string[]; conflict: boolean } | null {
  if (!(error instanceof ApiProblem)) return null;
  if (error.problem.code === "conflict") return { faults: [], conflict: true };
  if (error.problem.code === "invalid_request") return { faults: error.problem.faults ?? [error.problem.message], conflict: false };
  return null;
}

function Widget(props: {
  row: Row;
  tenant: string;
  gateway: string | null;
  readOnly: boolean;
  open?: StationId;
  onSaved: () => void;
  onProblem: (error: unknown) => void;
}) {
  const { row, tenant, gateway, readOnly, open, onSaved, onProblem } = props;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState<WidgetDocument | null>(null);
  const [faults, setFaults] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    void call<Draft>("GET", `/widgets/${row.widget_id}/draft`).then((found) => {
      setDraft(found);
      setEdited(found.document);
      setConflict(false);
    }, onProblem);
  }, [row.widget_id, onProblem]);
  useEffect(load, [load]);

  if (!draft || !edited) return <div className="ring" role="status" aria-label={t.loading} />;
  const document = draft.document;
  const track = stations({
    set: ["agent", "sites", "sign-in", "look"],
    version: row.version,
    unpublished: row.unpublished || row.version === null,
    signedIn: document.sign_in !== "anonymous",
  });
  const shown = open && track.some((one) => one.id === open) ? open : (track.find((one) => one.state === "now")?.id ?? "live");
  const left = timeLeft(track);
  const changed = JSON.stringify(edited) !== JSON.stringify(document);

  async function save() {
    const gap = missing(shown, edited!);
    if (gap) return setFaults([gap]);
    setSaving(true);
    try {
      const { revision } = await call<{ revision: number }>("PUT", `/widgets/${row.widget_id}/draft`, {
        revision: draft!.revision,
        document: edited,
      });
      setDraft({ revision, document: edited! });
      setFaults([]);
      setSaved(true);
      onSaved();
    } catch (error) {
      const refused = refusal(error);
      if (!refused) return onProblem(error);
      setFaults(refused.faults);
      setConflict(refused.conflict);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>{row.title}</h1>
      <p className="sub">
        {t.sites(document.allowed_domains.length)} · {who(document)}
      </p>
      <Track
        track={track}
        shown={shown}
        sign={row.version !== null && !left ? standing(row) : t.timeLeft(left)}
        reachable={() => true}
        onOpen={(id) => {
          setEdited(document);
          setFaults([]);
          setSaved(false);
          go(`/widgets/${row.widget_id}/${id}`);
        }}
      />
      <section className="card stop" aria-labelledby="stop-title">
        <header>
          <h2 id="stop-title">{t.station[shown]}</h2>
          <p>{t.stationIntro[shown]}</p>
        </header>
        {EDITED.includes(shown) ? (
          <>
            {readOnly && <p className="note">{t.readOnly}</p>}
            <StationEditor
              station={shown}
              widgetId={row.widget_id}
              tenant={tenant}
              document={edited}
              onChange={(next) => {
                setEdited(next);
                setSaved(false);
              }}
              readOnly={readOnly}
              onProblem={onProblem}
            />
            <Faults faults={faults} />
            {conflict && (
              <p className="problem" role="alert">
                {t.conflict}{" "}
                <button type="button" className="secondary" onClick={load}>
                  {t.reload}
                </button>
              </p>
            )}
            {!readOnly && (
              <div className="actions">
                <button type="button" className="primary" disabled={!changed || saving} onClick={() => void save()}>
                  {saving ? t.saving : t.save}
                </button>
                <output aria-live="polite" className="note">
                  {saved && !changed ? t.saved : ""}
                </output>
              </div>
            )}
          </>
        ) : shown === "install" ? (
          <Install widgetId={row.widget_id} gateway={gateway} document={document} />
        ) : (
          <Facts station={shown} row={row} document={document} />
        )}
      </section>
    </>
  );
}

const BLANK: WidgetDocument = {
  tenant_id: "",
  public: {},
  allowed_domains: [],
  sign_in: "anonymous",
  agent_profile: "",
  identity: null,
};

/** A new widget: the first three stations gather its settings here, then the draft is made and the journey goes on
 *  at Look. Only the next station is open. */
function NewWidget(props: {
  tenant: string;
  open?: StationId;
  onCreated: (widgetId: string) => void;
  onProblem: (error: unknown) => void;
}) {
  const { tenant, open, onCreated, onProblem } = props;
  const [title, setTitle] = useState("");
  const [document, setDocument] = useState<WidgetDocument>({ ...BLANK, tenant_id: tenant });
  const [set, setSet] = useState<StationId[]>([]);
  const [faults, setFaults] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const titleId = useId();

  const track = stations({ set, version: null, unpublished: true, signedIn: document.sign_in !== "anonymous" });
  const next = track.find((one) => one.state === "now")?.id ?? "agent";
  const reachable = (id: StationId) => EDITED.includes(id) && (set.includes(id) || id === next);
  const shown = open && reachable(open) ? open : next;

  async function carryOn() {
    const gap = !title.trim() ? t.nameMissing : missing(shown, document);
    if (gap) return setFaults([gap]);
    setFaults([]);
    const finished = [...new Set([...set, shown])];
    if (shown !== "sign-in") {
      setSet(finished);
      return go(`/widgets/new/${EDITED[EDITED.indexOf(shown) + 1]}`);
    }
    setCreating(true);
    try {
      const appearance = {
        title: title.trim(),
        welcome_message: null,
        suggested_prompts: [],
        ai_notice: null,
        brand_color: "#2B241F",
        logo_url: null,
        color_scheme: "auto",
        launcher_position: "bottom-right",
        history_enabled: document.sign_in !== "anonymous",
      };
      const { identity, ...rest } = document;
      const made = await call<{ widget_id: string }>("POST", `/tenants/${tenant}/widgets`, {
        document: { ...rest, ...(document.sign_in === "anonymous" ? {} : { identity }), public: appearance },
      });
      onCreated(made.widget_id);
    } catch (error) {
      const refused = refusal(error);
      if (!refused) return onProblem(error);
      setFaults(refused.faults);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <h1>{t.newTitle}</h1>
      <div className="field title">
        <label htmlFor={titleId}>{t.nameLabel}</label>
        <p className="hint">{t.nameHint}</p>
        <input id={titleId} type="text" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <Track track={track} shown={shown} sign={t.timeLeft(timeLeft(track))} reachable={reachable} onOpen={(id) => go(`/widgets/new/${id}`)} />
      <section className="card stop" aria-labelledby="stop-title">
        <header>
          <h2 id="stop-title">{t.station[shown]}</h2>
          <p>{t.stationIntro[shown]}</p>
        </header>
        <StationEditor
          station={shown}
          widgetId=""
          tenant={tenant}
          document={document}
          onChange={setDocument}
          readOnly={false}
          onProblem={onProblem}
        />
        <Faults faults={faults} />
        <div className="actions">
          <button type="button" className="primary" disabled={creating} onClick={() => void carryOn()}>
            {shown === "sign-in" ? (creating ? t.creating : t.create) : t.continue}
          </button>
        </div>
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
