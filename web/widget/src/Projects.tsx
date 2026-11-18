// Projects: a signed-in visitor's folders of chats. Their pages take the conversation's place, so on a wide frame
// they are full pages beside the list of chats; the filing control sits at the top of an open chat. Names are typed
// in place, never in a dialog.
import type { Conversation, Project } from "@ucp/protocol/v1";
import { type FormEvent, type KeyboardEvent, type Ref, useEffect, useId, useRef, useState } from "react";

import { when } from "./chat/history";
import { Icon } from "./Icon";
import { strings as t } from "./strings";

export const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const PLUS = "M12 5v14M5 12h14";
const BACK = "M15 18l-6-6 6-6";
const CHECK = "M5 12l5 5L19 8";

/** Escape inside closes the nearest form or card, not the whole chat. */
const escaping = (close: () => void) => (event: KeyboardEvent) => {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  close();
};

/** Chats as rows: the topic over when it was last active. */
export function ChatRows({
  chats,
  current,
  onOpen,
}: {
  chats: Conversation[];
  current: string | null;
  onOpen: (chat: Conversation) => void;
}) {
  return (
    <ul className="chats">
      {chats.map((chat) => (
        <li key={chat.id}>
          <button type="button" aria-current={chat.id === current ? "true" : undefined} onClick={() => onOpen(chat)}>
            <span className="topic" dir="auto">
              {chat.title}
            </span>
            <time dateTime={chat.updated_at}>{when(chat.updated_at)}</time>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A project's name, typed in place. A refusal keeps what was typed and says so. */
function NameForm({
  action,
  initial = "",
  onSave,
  onCancel,
}: {
  action: string;
  initial?: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  const field = useRef<HTMLInputElement>(null);
  const id = useId();

  useEffect(() => field.current?.select(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setState("saving");
    try {
      await onSave(name.trim());
    } catch {
      setState("failed");
    }
  }

  return (
    <form className="name-form" onSubmit={submit} onKeyDown={escaping(onCancel)}>
      <label htmlFor={id}>{t.projectName}</label>
      <div className="name-row">
        <input
          id={id}
          ref={field}
          value={name}
          maxLength={80}
          autoComplete="off"
          dir="auto"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="secondary" disabled={!name.trim() || state === "saving"}>
          {action}
        </button>
        <button type="button" className="quiet" onClick={onCancel}>
          {t.cancel}
        </button>
      </div>
      {state === "failed" && (
        <p className="meta" role="alert">
          {t.actionFailed}
        </p>
      )}
    </form>
  );
}

/** Every project, most recently active first, and a new one. */
export function ProjectsPage({
  projects,
  failed,
  titleRef,
  onOpen,
  onCreate,
  onRetry,
}: {
  projects: Project[] | null;
  failed: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  onOpen: (project: Project) => void;
  onCreate: (name: string) => Promise<void>;
  onRetry: () => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="view" aria-labelledby="view-title">
      <div className="view-head">
        <h2 id="view-title" ref={titleRef} tabIndex={-1}>
          {t.projects}
        </h2>
        {!adding && (
          <button type="button" className="secondary" onClick={() => setAdding(true)}>
            <Icon path={PLUS} />
            {t.newProject}
          </button>
        )}
      </div>
      {adding && <NameForm action={t.create} onSave={onCreate} onCancel={() => setAdding(false)} />}
      {failed ? (
        <div className="problem" role="alert">
          <p>{t.actionFailed}</p>
          <button type="button" className="secondary" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : projects === null ? (
        <p className="meta" role="status">
          {t.loadingProjects}
        </p>
      ) : projects.length === 0 ? (
        !adding && <p className="meta empty">{t.noProjects}</p>
      ) : (
        <ul className="chats projects">
          {projects.map((project) => (
            <li key={project.id}>
              <button type="button" onClick={() => onOpen(project)}>
                <span className="topic" dir="auto">
                  <Icon path={FOLDER} />
                  {project.name}
                </span>
                <time dateTime={project.updated_at}>{when(project.updated_at)}</time>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One project: its name, renamed or deleted in place, and its chats. The composer below starts a chat in it. */
export function ProjectPage({
  project,
  chats,
  failed,
  titleRef,
  onBack,
  onOpenChat,
  onRename,
  onDelete,
}: {
  project: Project;
  chats: Conversation[] | null;
  failed: boolean;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  onOpenChat: (chat: Conversation) => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"shown" | "renaming" | "deleting">("shown");
  const [refused, setRefused] = useState(false);
  const question = useId();

  async function remove() {
    setRefused(false);
    try {
      await onDelete();
    } catch {
      setRefused(true);
    }
  }

  return (
    <section className="view" aria-labelledby="view-title">
      <button type="button" className="quiet back" onClick={onBack}>
        <Icon path={BACK} flip />
        {t.allProjects}
      </button>
      {mode === "renaming" ? (
        <NameForm
          action={t.save}
          initial={project.name}
          onSave={async (name) => {
            await onRename(name);
            setMode("shown");
          }}
          onCancel={() => setMode("shown")}
        />
      ) : (
        <div className="view-head">
          <h2 id="view-title" ref={titleRef} tabIndex={-1} dir="auto">
            {project.name}
          </h2>
          <div className="view-acts">
            <button type="button" className="quiet" onClick={() => setMode("renaming")}>
              {t.rename}
            </button>
            <button type="button" className="quiet" onClick={() => setMode("deleting")}>
              {t.deleteProject}
            </button>
          </div>
        </div>
      )}
      {mode === "deleting" && (
        <div
          className="confirm"
          role="group"
          aria-labelledby={question} // read out with the button focus lands on
          onKeyDown={escaping(() => setMode("shown"))}
        >
          <p id={question} dir="auto">
            {t.confirmDelete(project.name)}
          </p>
          {refused && (
            <p className="meta" role="alert">
              {t.actionFailed}
            </p>
          )}
          <div className="confirm-acts">
            <button type="button" className="secondary" onClick={() => void remove()}>
              {t.delete}
            </button>
            {/* Focus starts on the safe choice. */}
            <button type="button" className="quiet" autoFocus onClick={() => setMode("shown")}>
              {t.cancel}
            </button>
          </div>
        </div>
      )}
      {failed ? (
        <p className="meta" role="alert">
          {t.actionFailed}
        </p>
      ) : chats === null ? (
        <p className="meta" role="status">
          {t.loadingChats}
        </p>
      ) : chats.length === 0 ? (
        <p className="meta empty">{t.noProjectChats}</p>
      ) : (
        <ChatRows chats={chats} current={null} onOpen={onOpenChat} />
      )}
    </section>
  );
}

/** At the top of an open chat: which project it is filed under, changed in a small card. */
export function ProjectPicker({
  projects,
  filed,
  onChoose,
  onCreate,
}: {
  projects: Project[] | null;
  filed: string | null;
  onChoose: (projectId: string | null) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refused, setRefused] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const card = useId();
  const name = projects?.find((project) => project.id === filed)?.name;

  function close() {
    setOpen(false);
    setAdding(false);
    setRefused(false);
    button.current?.focus();
  }

  async function choose(projectId: string | null) {
    setRefused(false);
    try {
      await onChoose(projectId);
      close();
    } catch {
      setRefused(true);
    }
  }

  const options = [{ id: null, name: t.noProject }, ...(projects ?? [])];
  return (
    <div className="filing">
      <button
        ref={button}
        type="button"
        className="quiet"
        aria-expanded={open}
        aria-controls={card}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon path={FOLDER} />
        <span dir="auto">{name ?? t.addToProject}</span>
      </button>
      {open && (
        <div id={card} className="filing-card" role="group" aria-label={t.projectFor} onKeyDown={escaping(close)}>
          <ul className="options">
            {options.map((option) => (
              <li key={option.id ?? "none"}>
                <button
                  type="button"
                  aria-current={option.id === filed ? "true" : undefined}
                  onClick={() => void choose(option.id)}
                >
                  <span dir="auto">{option.name}</span>
                  {option.id === filed && <Icon path={CHECK} />}
                </button>
              </li>
            ))}
          </ul>
          {refused && (
            <p className="meta" role="alert">
              {t.actionFailed}
            </p>
          )}
          {adding ? (
            <NameForm
              action={t.create}
              onSave={async (newName) => {
                await onCreate(newName);
                close();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button type="button" className="quiet" onClick={() => setAdding(true)}>
              <Icon path={PLUS} />
              {t.newProject}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
