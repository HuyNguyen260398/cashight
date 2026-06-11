// One-off: rasterize app/icon.svg into favicon.ico + apple-icon.png.
// Run with: pnpm tsx scripts/gen-favicon.mjs  (or: node scripts/gen-favicon.mjs)
import { createRequire } from "node:module";
// sharp is a transitive dep; resolve it from the pnpm store rather than a bare import.
const sharp = createRequire(import.meta.url)("../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js");
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");
const svg = readFileSync(join(appDir, "icon.svg"));

const png = (size) =>
  sharp(svg, { density: 384 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// Pack PNG buffers into an ICO container (PNG-embedded entries).
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const b = i * 16;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0); // width
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // palette
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bits per pixel
    dir.writeUInt32LE(e.data.length, b + 8);
    dir.writeUInt32LE(offset, b + 12);
    offset += e.data.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

const icoSizes = [16, 32, 48];
const entries = await Promise.all(icoSizes.map(async (size) => ({ size, data: await png(size) })));
writeFileSync(join(appDir, "favicon.ico"), buildIco(entries));
writeFileSync(join(appDir, "apple-icon.png"), await png(180));

console.log("Wrote app/favicon.ico (16/32/48) and app/apple-icon.png (180).");
