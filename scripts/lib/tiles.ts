import { mkdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";

export interface TilePyramidOptions {
  sourcePath: string;
  outputDir: string;
  /** Maximum zoom level inclusive. World at zoom Z = (2^(Z+1) * tileSize) wide. */
  maxZoom: number;
  /** Tile size in pixels. Standard slippy-map convention is 256. */
  tileSize: number;
  /** JPEG quality 1-100. */
  quality: number;
}

/**
 * Generate a tile pyramid from an equirectangular world image.
 *
 * For a 2:1 aspect (lon -180..180, lat -90..90), the world at zoom Z is laid
 * out as 2^(Z+1) tiles wide × 2^Z tiles tall, each `tileSize`×`tileSize`.
 * Tiles are written to `outputDir/{z}/{x}/{y}.jpg`.
 *
 * Approach per zoom level:
 *   1. Resize the source image to the level's effective resolution.
 *   2. Extract each tile from that resized buffer.
 * Sharp re-decodes the source from a Buffer per tile, but reuses the level's
 * resized buffer so it doesn't re-resize per tile (cheap).
 */
export async function generateTilePyramid(opts: TilePyramidOptions): Promise<void> {
  for (let z = 0; z <= opts.maxZoom; z++) {
    const tilesX = Math.pow(2, z + 1);
    const tilesY = Math.pow(2, z);
    const totalW = tilesX * opts.tileSize;
    const totalH = tilesY * opts.tileSize;

    console.log(
      `[tiles] zoom ${z}: resizing source to ${totalW}x${totalH} (${tilesX}x${tilesY} tiles)…`,
    );

    // Resize once per zoom level into a raw RGB buffer.
    const resized = await sharp(opts.sourcePath, { limitInputPixels: false })
      .resize(totalW, totalH, { kernel: sharp.kernel.lanczos3, fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = resized;
    const tilesAtThisZoom = tilesX * tilesY;
    console.log(`[tiles] zoom ${z}: writing ${tilesAtThisZoom} tiles…`);

    // Write tiles in parallel batches to keep sharp's worker pool busy.
    const batch: Promise<void>[] = [];
    const BATCH_SIZE = 16;
    let written = 0;
    for (let x = 0; x < tilesX; x++) {
      await mkdir(`${opts.outputDir}/${z}/${x}`, { recursive: true });
      for (let y = 0; y < tilesY; y++) {
        const tilePath = `${opts.outputDir}/${z}/${x}/${y}.jpg`;
        const job = sharp(data, {
          raw: { width: info.width, height: info.height, channels: info.channels },
        })
          .extract({
            left: x * opts.tileSize,
            top: y * opts.tileSize,
            width: opts.tileSize,
            height: opts.tileSize,
          })
          .jpeg({ quality: opts.quality, mozjpeg: false })
          .toFile(tilePath)
          .then(() => {
            written++;
            if (written % 64 === 0) {
              process.stdout.write(
                `\r[tiles] zoom ${z}: ${written}/${tilesAtThisZoom}`,
              );
            }
          });
        batch.push(job);
        if (batch.length >= BATCH_SIZE) {
          await Promise.all(batch);
          batch.length = 0;
        }
      }
    }
    if (batch.length) await Promise.all(batch);
    process.stdout.write(
      `\r[tiles] zoom ${z}: ${tilesAtThisZoom}/${tilesAtThisZoom} done.\n`,
    );
  }
}

/** Returns the on-disk byte size of a generated tile directory. */
export async function tilesDirSize(dir: string): Promise<number> {
  let total = 0;
  async function walk(d: string) {
    if (!existsSync(d)) return;
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = `${d}/${e.name}`;
      if (e.isDirectory()) {
        await walk(full);
      } else {
        const s = await stat(full);
        total += s.size;
      }
    }
  }
  await walk(dir);
  return total;
}

export async function clearTiles(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await rm(dir, { recursive: true, force: true });
  }
}
