// A zip archive's files (M3-T8): Word, Excel and PowerPoint files are zip archives of XML. The central directory is
// read for the names, and a file is inflated only when asked for, by the browser's own DecompressionStream. Each file
// is held to a size, so a small archive that would inflate to gigabytes (a zip bomb) stops at the limit.

const LIMIT = 20 * 1024 * 1024; // bytes one file inside may inflate to

export type Zip = Map<string, () => Promise<Uint8Array>>;

/** The archive's files by name, each read on request; null if this is not a zip archive we can read. */
export function unzip(data: ArrayBuffer): Zip | null {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  // The end record sits in the last 22 bytes, or further back behind a comment of up to 65,535 bytes.
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65_535); at--) {
    if (view.getUint32(at, true) === 0x06054b50) {
      end = at;
      break;
    }
  }
  if (end < 0) return null;
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files: Zip = new Map();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) return null;
    const method = view.getUint16(at + 10, true);
    const packed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const [nameLength, extra, comment] = [view.getUint16(at + 28, true), view.getUint16(at + 30, true), view.getUint16(at + 32, true)];
    const local = view.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (packed === 0xffffffff || local + 30 > bytes.length) return null; // zip64: never needed for a file this size
    files.set(name, async () => {
      if (view.getUint32(local, true) !== 0x04034b50) throw new Error("not a zip entry");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const body = bytes.subarray(start, start + packed);
      if (method === 0) return body;
      if (method !== 8 || size > LIMIT) throw new Error("cannot read this entry");
      return inflate(body);
    });
  }
  return files;
}

async function inflate(body: Uint8Array): Promise<Uint8Array> {
  const packed = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
  const reader = packed.pipeThrough(new DecompressionStream("deflate-raw") as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > LIMIT) {
      void reader.cancel().catch(() => {}); // not awaited: the rest is never inflated
      throw new Error("too large");
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) out.set(part, (at += part.length) - part.length);
  return out;
}

/** A file inside as text, or "" when it is not there. */
export async function text(zip: Zip, name: string): Promise<string> {
  const read = zip.get(name);
  return read ? new TextDecoder().decode(await read()) : "";
}
