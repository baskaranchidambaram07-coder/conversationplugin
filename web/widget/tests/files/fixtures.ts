// Office files built in memory for the file viewer's tests.

/** A zip archive of the given files, each stored, or deflated by the platform's CompressionStream. */
export async function zip(files: Record<string, string | Uint8Array>, deflate = false): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? encoder.encode(content) : content;
    const body = deflate ? new Uint8Array(await new Response(new Response(raw as BodyInit).body!.pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    const title = encoder.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, deflate ? 8 : 0, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, title.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, deflate ? 8 : 0, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, raw.length, true);
    central.setUint16(28, title.length, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), title, body);
    centrals.push(new Uint8Array(central.buffer), title);
    offset += 30 + title.length + body.length;
  }
  const size = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...locals, ...centrals, new Uint8Array(end.buffer)] as BlobPart[]).arrayBuffer();
}

