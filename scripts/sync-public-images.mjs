#!/usr/bin/env node
/**
 * scripts/sync-public-images.mjs
 *
 * Copy images/ (WebP + manifest.json + failed.json) into public/images/ so the
 * static site (dev server and build) can serve them at /images/....
 * public/images/ is git-ignored; the real source of truth is /images.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(ROOT, 'images');
const DEST = resolve(ROOT, 'public/images');

if (!existsSync(SRC)) {
  console.log('images/ not found; nothing to sync.');
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(dirname(DEST), { recursive: true });
cpSync(SRC, DEST, { recursive: true });
console.log(`Synced ${SRC} -> ${DEST}`);
