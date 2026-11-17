// The console's home (route /): where things stand at a glance, beside the next things to do. Everyone sees their
// organisation's figures and widgets and can make a widget; a platform administrator also sees every organisation's
// widgets by state, picks one to work in, and can make an organisation.
import { type ReactNode, useEffect, useState } from "react";

import { call } from "./api";
import { strings as t } from "./strings";
import { Glyph, ICON, onRoute } from "./ui";

export type Tenant = { tenant_id: string; name: string };
export type Row = { widget_id: string; title: string; version: number | null; unpublished: boolean };
export type State = "live" | "waiting" | "setup";
export type Counts = Record<State, number>;

const STATES: State[] = ["live", "waiting", "setup"]; // the bars' fixed order, so position tells them apart too
const SHOWN = 8;

export const stateOf = (row: Row): State => (row.version === null ? "setup" : row.unpublished ? "waiting" : "live");

export function countsOf(rows: Row[]): Counts {
  const counts: Counts = { live: 0, waiting: 0, setup: 0 };
  for (const row of rows) counts[stateOf(row)] += 1;
  return counts;
}

export function Home(props: {
  platform: boolean;
  canEdit: boolean;
  tenants: Tenant[];
  tenant: string;
  rows: Row[];
  onChoose: (tenant: string) => void;
  onProblem: (error: unknown) => void;
  children?: ReactNode; // what follows the panels: the notice, deleting an empty organisation
}) {
  const { platform, canEdit, tenants, tenant, rows, onChoose, onProblem, children } = props;
  const [others, setOthers] = useState<Record<string, Counts> | null>(null);
  const [everyOne, setEveryOne] = useState(false);

  useEffect(() => {
    if (!platform) return;
    // Every organisation's counts in one call (the admin API's overview), however many organisations there are.
    call<(Counts & { tenant_id: string })[]>("GET", "/overview").then(
      (found) => setOthers(Object.fromEntries(found.map(({ tenant_id, ...each }) => [tenant_id, each]))),
      onProblem,
    );
  }, [platform, tenants, onProblem]);

  const name = tenants.find((one) => one.tenant_id === tenant)?.name ?? tenant;
  const counts = countsOf(rows);
  // The organisation open here counts from its own widget list, so a change shows at once.
  const countsFor = (id: string): Counts => (id === tenant ? counts : (others?.[id] ?? { live: 0, waiting: 0, setup: 0 }));
  const sum = (each: Counts) => each.live + each.waiting + each.setup;
  const most = Math.max(1, ...tenants.map((one) => sum(countsFor(one.tenant_id))));
  // The busiest first; past SHOWN of them, the rest wait behind a button (the open one always shows).
  const ranked = [...tenants].sort((x, y) => sum(countsFor(y.tenant_id)) - sum(countsFor(x.tenant_id)));
  const shown = everyOne ? ranked : ranked.filter((one, index) => index < SHOWN || one.tenant_id === tenant);

  return (
    <div className="home">
      <h1>{name}</h1>
      <p className="sub">{t.organisationFacts(rows.length, tenant)}</p>

      <dl className="figures" aria-label={t.atAGlance}>
        {platform && <Figure label={t.organisations} value={tenants.length} />}
        <Figure label={t.widgets} value={rows.length} />
        {STATES.map((state) => (
          <Figure key={state} label={t.states[state]} value={counts[state]} state={state} />
        ))}
      </dl>

      <div className="panels">
        <div className="panel">
          <div className="panel-head">
            <h2>{t.widgetsIn(name)}</h2>
          </div>
          {rows.length ? (
            <ul className="widgets">
              {rows.map((row) => (
                <li key={row.widget_id}>
                  <a href={`/widgets/${row.widget_id}`} onClick={onRoute(`/widgets/${row.widget_id}`)}>
                    <span className={`state ${stateOf(row)}`} aria-hidden="true" />
                    <b>{row.title}</b>
                    <small>{t.states[stateOf(row)]}</small>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">
              {t.noWidgets} {canEdit && t.firstWidget}
            </p>
          )}
        </div>

        {platform && (
          <div className="panel">
            <div className="panel-head">
              <h2>{t.organisations}</h2>
              <a className="primary" href="/organisations/new" onClick={onRoute("/organisations/new")}>
                <Glyph path={ICON.plus} />
                {t.newOrganisation}
              </a>
            </div>
            <p className="legend" aria-hidden="true">
              {STATES.map((state) => (
                <span key={state}>
                  <i className={`swatch-${state}`} />
                  {t.states[state]}
                </span>
              ))}
            </p>
            {others ? (
              <ul className="organisations">
                {shown.map((one) => {
                  const each = countsFor(one.tenant_id);
                  const total = sum(each);
                  return (
                    <li key={one.tenant_id}>
                      <button type="button" aria-current={one.tenant_id === tenant ? "true" : undefined} onClick={() => onChoose(one.tenant_id)}>
                        <b>{one.name}</b>
                        <span className="bar" style={{ inlineSize: `${(total / most) * 100}%` }} aria-hidden="true">
                          {STATES.filter((state) => each[state]).map((state) => (
                            <i key={state} className={`swatch-${state}`} style={{ flexGrow: each[state] }} title={t.stateCount(each[state], state)} />
                          ))}
                        </span>
                        <small>{total ? STATES.filter((state) => each[state]).map((state) => t.stateCount(each[state], state)).join(" · ") : t.zeroWidgets}</small>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="ring" role="status" aria-label={t.loading} />
            )}
            {others && shown.length < ranked.length && (
              <button type="button" className="quiet" onClick={() => setEveryOne(true)}>
                {t.showAllOrganisations(ranked.length)}
              </button>
            )}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function Figure({ label, value, state }: { label: string; value: number; state?: State }) {
  return (
    <div className="figure">
      <dt>
        {state && <i className={`swatch-${state}`} aria-hidden="true" />}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
