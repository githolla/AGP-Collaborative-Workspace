/**
 * Build the Teams app package — a zip of manifest.json + the two icons, which
 * is the only artefact Teams accepts for sideloading or catalog publishing.
 *
 * The URL is substituted at build time so the same manifest produces a package
 * for production or for a preview deployment:
 *
 *   node apps/tab/teams/build-package.mjs
 *   TEAMS_APP_URL=https://preview.example.com node apps/tab/teams/build-package.mjs
 *
 * Output: apps/tab/teams/dist/agp-collaboration-teams.zip
 *
 * Written with zlib + a hand-rolled zip writer rather than a dependency: the
 * archive is three small files, and adding a packaging library to the app's
 * production tree to build it would be a poor trade.
 */
import { deflateRawSync, crc32 } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_URL = "https://collaboration.teamallegiance.com";
const appUrl = (process.env.TEAMS_APP_URL || DEFAULT_URL).replace(/\/+$/, "");
const host = new URL(appUrl).hostname;

const manifest = JSON.parse(readFileSync(path.join(here, "manifest.json"), "utf8"));
// Point every URL at the target deployment and trust only its host.
manifest.developer.websiteUrl = appUrl;
manifest.developer.privacyUrl = `${appUrl}/#privacy`;
manifest.developer.termsOfUseUrl = `${appUrl}/#terms`;
manifest.configurableTabs[0].configurationUrl = `${appUrl}/#teams-config`;
manifest.staticTabs[0].contentUrl = `${appUrl}/`;
manifest.staticTabs[0].websiteUrl = `${appUrl}/`;
manifest.validDomains = [host];

const files = [
  { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
  { name: "color.png", data: readFileSync(path.join(here, "color.png")) },
  { name: "outline.png", data: readFileSync(path.join(here, "outline.png")) },
];

/** Minimal stored/deflated zip writer (PKZIP, no directories, no extras). */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date — fixed, so builds are reproducible
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(entry.data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(0, 42); // local header offset — patched below
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}

const outDir = path.join(here, "dist");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "agp-collaboration-teams.zip");
writeFileSync(out, zip(files));
console.log(`Teams package written: ${path.relative(process.cwd(), out)}`);
console.log(`  app URL      ${appUrl}`);
console.log(`  validDomains ${host}`);
