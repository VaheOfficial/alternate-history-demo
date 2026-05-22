import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadOptions {
  url: string;
  destination: string;
  expectedMinBytes?: number;
}

export async function downloadCached(opts: DownloadOptions): Promise<void> {
  await mkdir(dirname(opts.destination), { recursive: true });

  try {
    const s = await stat(opts.destination);
    if (s.size > 0 && (!opts.expectedMinBytes || s.size >= opts.expectedMinBytes)) {
      console.log(`[download] cache hit: ${opts.destination} (${s.size} bytes)`);
      return;
    }
  } catch {
    // not present yet
  }

  console.log(`[download] fetching ${opts.url}`);
  const res = await fetch(opts.url);
  if (!res.ok) {
    throw new Error(
      `download failed ${res.status} ${res.statusText} from ${opts.url}`,
    );
  }
  if (!res.body) {
    throw new Error("no body in download response");
  }
  const out = createWriteStream(opts.destination);
  const webStream = res.body as unknown as ReadableStream<Uint8Array>;
  const nodeStream = Readable.fromWeb(webStream as any);
  await pipeline(nodeStream, out);
  const finalSize = (await stat(opts.destination)).size;
  console.log(`[download] saved ${opts.destination} (${finalSize} bytes)`);
  if (opts.expectedMinBytes && finalSize < opts.expectedMinBytes) {
    throw new Error(
      `downloaded file smaller than expected (${finalSize} < ${opts.expectedMinBytes})`,
    );
  }
}
