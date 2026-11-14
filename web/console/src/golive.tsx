// The Go live station (M9-T6): what the draft changes, publishing it as the next version, the history, comparing
// a version with the live one, and making an earlier version live again. Publishing names the revision read, so a
// change someone else saved since is never published unseen.
import { useCallback, useEffect, useState } from "react";

import { ApiProblem, call } from "./api";
import type { WidgetDocument } from "./App";
import { strings as t } from "./strings";

type Version = { version: number; published_at: string; published_by: string | null };
type Change = { path: string; from: unknown; to: unknown };

/** Every setting that differs between two documents, by its dotted path, as the admin API compares versions. */
export function changes(before: unknown, after: unknown, path = ""): Change[] {
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => changes(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path, from: before, to: after }];
}

function shown(value: unknown): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return t.nothing;
  if (typeof value === "boolean") return value ? t.yes : t.no;
  return Array.isArray(value) ? value.join(" · ") : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function Changes({ list, before, after }: { list: Change[]; before: string; after: string }) {
  if (!list.length) return <p className="note">{t.noChanges}</p>;
  return (
    <table className="changes">
      <thead>
        <tr>
          <th scope="col">{t.setting}</th>
          <th scope="col">{before}</th>
          <th scope="col">{after}</th>
        </tr>
      </thead>
      <tbody>
        {list.map((change) => (
          <tr key={change.path}>
            <th scope="row">{t.settingName[change.path] ?? change.path}</th>
            <td>{shown(change.from)}</td>
            <td>{shown(change.to)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function GoLive(props: {
  widgetId: string;
  live: number | null;
  revision: number;
  document: WidgetDocument;
  readOnly: boolean;
  onChanged: () => void;
  onProblem: (error: unknown) => void;
}) {
  const { widgetId, live, revision, document, readOnly, onChanged, onProblem } = props;
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [liveDocument, setLiveDocument] = useState<WidgetDocument | null>(null);
  const [compared, setCompared] = useState<{ version: number; list: Change[] } | null>(null);
  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const found = await call<Version[]>("GET", `/widgets/${widgetId}/versions`);
      setVersions(found);
      const newest = found[0]?.version;
      setLiveDocument(newest ? (await call<{ document: WidgetDocument }>("GET", `/widgets/${widgetId}/versions/${newest}`)).document : null);
    } catch (error) {
      if (error instanceof ApiProblem && error.status === 404) setVersions([]);
      else onProblem(error);
    }
  }, [widgetId, onProblem]);
  useEffect(() => void load(), [load]);

  const pending = changes(liveDocument ?? {}, document);
  const unpublished = revision > 0 && (live === null || pending.length > 0);

  async function act(run: () => Promise<{ version: number }>, done: (version: number) => string) {
    setBusy(true);
    setNote("");
    try {
      const { version } = await run();
      setNote(done(version));
      setCompared(null);
      setRollingBack(null);
      await load();
      onChanged();
    } catch (error) {
      if (error instanceof ApiProblem && error.problem.code === "conflict") setNote(t.conflict);
      else if (error instanceof ApiProblem && error.problem.code === "invalid_request") setNote(t.publishRefused);
      else onProblem(error);
    } finally {
      setBusy(false);
    }
  }

  async function compare(version: number) {
    if (compared?.version === version) return setCompared(null);
    try {
      const other = await call<{ document: WidgetDocument }>("GET", `/widgets/${widgetId}/versions/${version}`);
      setCompared({ version, list: changes(liveDocument ?? {}, other.document) });
    } catch (error) {
      onProblem(error);
    }
  }

  return (
    <div className="editor golive">
      <section>
        <h3>{live === null ? t.notLive : t.live(live)}</h3>
        {unpublished ? (
          <>
            <p className="hint">{live === null ? t.firstPublish : t.toPublish}</p>
            {live !== null && <Changes list={pending} before={t.liveNow} after={t.draft} />}
            {!readOnly && (
              <div className="actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => void act(() => call("POST", `/widgets/${widgetId}/publish`, { revision }), t.published)}
                >
                  {busy ? t.publishing : t.publish(live === null ? 1 : (versions?.[0]?.version ?? live) + 1)}
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="hint">{t.upToDate}</p>
        )}
        <output aria-live="polite" className="note">
          {note}
        </output>
      </section>
      {versions && versions.length > 0 && (
        <section>
          <h3>{t.versionsTitle}</h3>
          <ol className="versions">
            {versions.map((one, index) => (
              <li key={one.version}>
                <div className="line">
                  <span>
                    <b>{t.versionName(one.version)}</b> {index === 0 && <span className="chip">{t.liveNow}</span>}
                    <small>{t.publishedBy(one.published_by ?? t.someone, one.published_at)}</small>
                  </span>
                  {index > 0 && (
                    <span className="actions">
                      <button type="button" className="quiet" aria-expanded={compared?.version === one.version} onClick={() => void compare(one.version)}>
                        {t.compareWithLive}
                      </button>
                      {!readOnly &&
                        (rollingBack === one.version ? (
                          <>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void act(() => call("POST", `/widgets/${widgetId}/rollback`, { version: one.version }), (made) => t.rolledBack(one.version, made))
                              }
                            >
                              {t.confirmRollback(one.version)}
                            </button>
                            <button type="button" className="quiet" onClick={() => setRollingBack(null)}>
                              {t.cancel}
                            </button>
                          </>
                        ) : (
                          <button type="button" className="quiet" onClick={() => setRollingBack(one.version)}>
                            {t.rollBack}
                          </button>
                        ))}
                    </span>
                  )}
                </div>
                {compared?.version === one.version && <Changes list={compared.list} before={t.liveNow} after={t.versionName(one.version)} />}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
