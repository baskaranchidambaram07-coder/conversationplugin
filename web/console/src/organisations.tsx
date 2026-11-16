// Organisations (tenants) in the console: making one (platform administrators), and deleting a widget or an
// organisation. A deletion asks for the name typed back, says what goes and what stays, and is refused by the API
// while an organisation still has widgets.
import { useState } from "react";

import { ApiProblem, call } from "./api";
import { Faults, Field } from "./editors";
import { strings as t } from "./strings";

export type Made = { tenant_id: string; name: string };

export function NewOrganisation({ onCreated, onProblem }: { onCreated: (made: Made) => void; onProblem: (error: unknown) => void }) {
  const [name, setName] = useState("");
  const [fault, setFault] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return setFault(t.organisationNameMissing);
    setBusy(true);
    try {
      onCreated(await call<Made>("POST", "/tenants", { name: name.trim() }));
    } catch (error) {
      onProblem(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>{t.newOrganisation}</h1>
      <p className="sub">{t.newOrganisationIntro}</p>
      <section className="card stop" aria-label={t.newOrganisation}>
        <form
          className="editor"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field label={t.organisationName} hint={t.organisationNameHint}>
            {(id) => (
              <input
                id={id}
                type="text"
                maxLength={120}
                autoComplete="organization"
                aria-invalid={Boolean(fault) || undefined}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setFault("");
                }}
              />
            )}
          </Field>
          <Faults faults={fault ? [fault] : []} />
          <div className="actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t.creatingOrganisation : t.createOrganisation}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

/** Deleting a widget or an organisation: what goes and what stays, then the name typed back before it happens. */
export function Deletion(props: {
  title: string;
  name: string;
  consequences: string;
  action: string;
  onDelete: () => Promise<void>;
  onProblem: (error: unknown) => void;
}) {
  const { title, name, consequences, action, onDelete, onProblem } = props;
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function remove() {
    setBusy(true);
    setNote("");
    try {
      await onDelete();
    } catch (error) {
      // Changed meanwhile: a widget made in the organisation, or the thing already deleted by someone else.
      if (error instanceof ApiProblem && (error.problem.code === "conflict" || error.problem.code === "not_found")) setNote(t.deleteChanged);
      else onProblem(error);
      setBusy(false);
    }
  }

  return (
    <section className="deletion" aria-label={title}>
      <h3>{title}</h3>
      <p className="hint">{consequences}</p>
      {asking ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim() === name) void remove();
          }}
        >
          <Field label={t.typeToConfirm(name)}>
            {(id) => (
              <input id={id} type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(event) => setTyped(event.target.value)} />
            )}
          </Field>
          <div className="actions">
            <button type="submit" className="primary" disabled={typed.trim() !== name || busy}>
              {busy ? t.deleting : t.confirmDelete(name)}
            </button>
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setAsking(false);
                setTyped("");
              }}
            >
              {t.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setAsking(true)}>
            {action}
          </button>
        </div>
      )}
      <output aria-live="polite" className="note">
        {note}
      </output>
    </section>
  );
}
