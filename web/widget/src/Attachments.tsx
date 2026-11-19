// Attachments (M10-T5): files chosen, dropped or pasted into the composer, uploaded at once, and sent with the
// question. The gateway checks every file again from its bytes; the checks here only explain a refusal sooner.
import type { Block } from "@ucp/protocol/v1";
import { lazy, Suspense, useEffect, useState } from "react";

import { Icon } from "./Icon";
import { strings as t } from "./strings";

export type FileBlock = Extract<Block, { type: "file" }>;
/** A file in the composer: uploading (progress 0 to 1), uploaded (block), or refused (problem). */
export type Pending = {
  key: string;
  name: string;
  size: number;
  picture: string | null; // a local address for a picture's thumbnail, freed when the chip goes
  progress: number;
  block: FileBlock | null;
  problem: string | null;
};

const FileViewer = lazy(() => import("./files/FileViewer"));

export const LIMIT_BYTES = 10 * 1024 * 1024;
export const PER_QUESTION = 5;
const EXTENSIONS = ["pdf", "doc", "docx", "jpg", "jpeg", "png"];
export const ACCEPT = [
  ...EXTENSIONS.map((extension) => `.${extension}`),
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
].join(",");

export const CLIP =
  "M20.5 11.5 12 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 18a2 2 0 0 1-3-3l7.5-7.5";
const PAGE = "M7 3h7l5 5v13H7zM14 3v5h5";
const CROSS = "M6 6l12 12M18 6 6 18";

const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
export const isPicture = (name: string) => ["jpg", "jpeg", "png"].includes(extensionOf(name));

/** Why a file cannot be attached, in the visitor's words, or null. `already` counts the files attached so far. */
export function refusal(file: { name: string; size: number }, already: number): string | null {
  if (already >= PER_QUESTION) return t.fileTooMany;
  if (!EXTENSIONS.includes(extensionOf(file.name))) return t.fileWrongType(file.name);
  if (file.size === 0) return t.fileEmpty(file.name);
  if (file.size > LIMIT_BYTES) return t.fileTooBig(file.name);
  return null;
}

/** "48 KB", "1.2 MB": sizes as people read them. */
export function sizeOf(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Hands the visitor a file to save. A download, never a page: nothing in it runs here. */
export function save(blob: Blob, name: string) {
  const address = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: address, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(address), 1000);
}

/** A file in the composer, before the question goes. */
export function PendingChip({ file, onRemove }: { file: Pending; onRemove: () => void }) {
  useEffect(() => () => void (file.picture && URL.revokeObjectURL(file.picture)), [file.picture]);
  const uploading = !file.block && !file.problem;
  return (
    <li className={file.problem ? "file refused" : "file"}>
      {file.picture ? <img src={file.picture} alt="" /> : <Icon path={PAGE} />}
      <span className="file-name" dir="auto">
        {file.name}
      </span>
      <span className="file-size">{file.problem ? t.fileFailed : sizeOf(file.size)}</span>
      {uploading && (
        <span className="file-progress" role="progressbar" aria-label={t.uploading(file.name)} aria-valuenow={Math.round(file.progress * 100)}>
          <span style={{ inlineSize: `${Math.round(file.progress * 100)}%` }} />
        </span>
      )}
      <button type="button" className="file-remove" aria-label={t.removeFile(file.name)} onClick={onRemove}>
        <Icon path={CROSS} />
      </button>
    </li>
  );
}

/** A file sent with a question, or carried by an answer: opened on a press in the full-screen viewer (M3-T8), which
 *  shows it or offers to save it. A picture shows itself on the card, fetched with the visitor's session. */
export function SentChip({ block, fetchFile }: { block: FileBlock; fetchFile: (id: string) => Promise<Blob> }) {
  const [picture, setPicture] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);

  useEffect(() => {
    if (!isPicture(block.name)) return;
    let address: string | null = null;
    let gone = false;
    fetchFile(block.id)
      .then((blob) => {
        if (gone) return;
        address = URL.createObjectURL(blob);
        setPicture(address);
      })
      .catch(() => {}); // the glyph stays; the visitor can still try to save it
    return () => {
      gone = true;
      if (address) URL.revokeObjectURL(address);
    };
  }, [block.id]);

  return (
    <li>
      <button
        type="button"
        className="file file-open"
        aria-haspopup="dialog"
        aria-label={t.openFile(block.name)}
        // Safari does not focus a button on a click; focused, it is where the viewer gives focus back.
        onClick={(event) => (event.currentTarget.focus(), setViewing(true))}
      >
        {picture ? <img src={picture} alt="" /> : <Icon path={PAGE} />}
        <span className="file-name" dir="auto">
          {block.name}
        </span>
        <span className="file-size">{sizeOf(block.size)}</span>
      </button>
      {viewing && (
        <Suspense fallback={null}>
          <FileViewer name={block.name} id={block.id} fetchFile={fetchFile} onClose={() => setViewing(false)} />
        </Suspense>
      )}
    </li>
  );
}
