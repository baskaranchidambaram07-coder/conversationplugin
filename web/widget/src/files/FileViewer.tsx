// A file card's full-screen viewer (M3-T8): the file fetched once with the visitor's session, shown by FileView, and
// saved from the bar. Loaded only when a file is opened, so the chat's first load carries none of it.
import { useMemo, useState } from "react";

import { save } from "../Attachments";
import { DOWNLOAD, Icon } from "../Icon";
import { strings as t } from "../strings";
import { Viewer } from "../Viewer";
import FileView, { kindOf, zooms } from "./FileView";

type Props = { name: string; id: string; fetchFile: (id: string) => Promise<Blob>; onClose: () => void };

export default function FileViewer({ name, id, fetchFile, onClose }: Props) {
  const [failed, setFailed] = useState(false);
  const load = useMemo(() => {
    let once: Promise<Blob> | null = null;
    return () => (once ??= fetchFile(id).catch((problem) => ((once = null), Promise.reject(problem))));
  }, [id]);
  const keep = () => {
    setFailed(false);
    load().then(
      (blob) => save(blob, name),
      () => setFailed(true),
    );
  };
  return (
    <Viewer
      title={name}
      zoomable={zooms(kindOf(name))}
      onClose={onClose}
      actions={
        <button type="button" className="icon" aria-label={t.saveFile(name)} onClick={keep}>
          <Icon path={DOWNLOAD} />
        </button>
      }
    >
      {failed && (
        <p className="file-note" role="alert">
          {t.fileSaveFailed}
        </p>
      )}
      <FileView name={name} load={load} />
    </Viewer>
  );
}
