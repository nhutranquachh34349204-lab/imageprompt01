#!/usr/bin/env node
/**
 * scripts/generate-images.mjs
 *
 * Regenerate images from public/prompts.json using an external image API
 * (OpenAI-compatible /images/generations endpoint) configured via env vars.
 * Output goes to raw/<ID>.png, then scripts/process-images.mjs creates the
 * optimized WebP files in images/ + images/manifest.json.
 *
 * Env vars (see .env.example):
 *   IMAGE_API_KEY      - required (never hardcoded / never committed)
 *   IMAGE_API_BASE_URL - default https://api.openai.com/v1
 *   IMAGE_API_MODEL    - default gpt-image-1 (supports 16:9 via size param)
 *   IMAGE_SIZE         - default 1536x1024 (API-side size; processing normalizes)
 *   IMAGE_NEGATIVE_PROMPT_AS_TEXT - "1" to append negative prompt as avoid-text
 *
 * CLI flags:
 *   --range=IMG_010..IMG_050   generate a contiguous ID range
 *   --only=IMG_007,IMG_012     generate specific IDs
 *   --force                    regenerate even if the file exists
 *   --concurrency=3            parallel API calls (default 3)
 *   --dry-run                  print what would be done, no API calls
 *
 * Default behavior: skip IDs whose processed image already exists in images/.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_PATH = resolve(ROOT, 'public/prompts.json');
const RAW_DIR = resolve(ROOT, 'raw');

// Load .env manually (no extra dependency).
try {
  const envRaw = readFileSync(resolve(ROOT, '.env'), 'utf8');
  for (const line of envRaw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !m[1].startsWith('#')) {
      const val = m[2].replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
} catch {
  /* .env is optional */
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const onlyRaw = (arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const rangeRaw = arg('range', '');
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');
const concurrency = Math.max(1, Number(arg('concurrency', '3')) || 3);

const API_KEY = process.env.IMAGE_API_KEY || '';
const BASE_URL = (process.env.IMAGE_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const MODEL = process.env.IMAGE_API_MODEL || 'gpt-image-1';
const SIZE = process.env.IMAGE_SIZE || '1536x1024';
const APPEND_NEG = process.env.IMAGE_NEGATIVE_PROMPT_AS_TEXT === '1';

// ---- select IDs -----------------------------------------------------------
const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf8'));
const byId = new Map(prompts.map((p) => [p.id, p]));

let selected;
if (onlyRaw.length) {
  selected = onlyRaw;
} else if (rangeRaw) {
  const m = /^IMG_(\d+)\.\.IMG_(\d+)$/.exec(rangeRaw);
  if (!m) throw new Error(`Invalid --range "${rangeRaw}". Expected IMG_010..IMG_050`);
  const [a, b] = [Number(m[1]), Number(m[2])];
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  selected = [];
  for (let n = lo; n <= hi; n++) selected.push(`IMG_${String(n).padStart(3, '0')}`);
} else {
  selected = prompts.map((p) => p.id);
}

function listProcessedIds() {
  const set = new Set();
  try {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'images/manifest.json'), 'utf8'));
    for (const it of manifest.items ?? []) set.add(it.id);
  } catch {
    /* no manifest yet */
  }
  return set;
}
const processedIds = listProcessedIds();

const jobs = [];
for (const id of selected) {
  const item = byId.get(id);
  if (!item) {
    console.warn(`SKIP unknown ID: ${id}`);
    continue;
  }
  if (!force && processedIds.has(id)) {
    console.log(`SKIP (already has image): ${id}`);
    continue;
  }
  jobs.push(item);
}

if (dryRun) {
  console.log(`DRY RUN: would generate ${jobs.length} image(s) with model=${MODEL} size=${SIZE}`);
  for (const j of jobs) console.log(`  - ${j.id}`);
  process.exit(0);
}

if (!API_KEY) {
  console.error(
    'FATAL: IMAGE_API_KEY is not set. Copy .env.example to .env and set IMAGE_API_KEY.'
  );
  process.exit(1);
}

// ---- API call -------------------------------------------------------------
async function callApi(item) {
  const body = {
    model: MODEL,
    prompt: APPEND_NEG && item.negative_prompt
      ? `${item.prompt}\n\nAvoid in the image: ${item.negative_prompt}`
      : item.prompt,
    n: 1,
    size: SIZE, // API-side; final WebP is normalized by process-images.mjs
    quality: 'standard',
    response_format: 'b64_json',
  };

  const res = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('API response has no b64_json image');
  const out = resolve(RAW_DIR, `${item.id}.png`);
  writeFileSync(out, Buffer.from(b64, 'base64'));
  return out;
}

// ---- run with concurrency -------------------------------------------------
const failures = [];
const results = [];
let next = 0;
let active = 0;
let done = 0;

console.log(`Generating ${jobs.length} image(s) with ${concurrency} concurrent worker(s)...`);

await new Promise((resolvePromise) => {
  const pump = () => {
    while (active < concurrency && next < jobs.length) {
      const item = jobs[next++];
      active++;
      callApi(item)
        .then((path) => {
          results.push({ id: item.id, path });
          console.log(`OK   ${item.id} -> ${path}`);
        })
        .catch((err) => {
          failures.push({ id: item.id, error: String(err?.message ?? err), created_at: new Date().toISOString() });
          console.error(`FAIL ${item.id}: ${err?.message ?? err}`);
        })
        .finally(() => {
          active--;
          done++;
          if (done === jobs.length) resolvePromise();
          else pump();
        });
    }
  };
  pump();
});

writeFileSync(
  resolve(ROOT, 'images/failed.json'),
  JSON.stringify(failures, null, 2) + '\n'
);
console.log('--- generate-images.mjs report ---');
console.log(`Generated: ${results.length}, failed: ${failures.length}, skipped: ${selected.length - jobs.length}`);
console.log('Next step: node scripts/process-images.mjs');

if (failures.length) {
  console.log('Failures written to images/failed.json');
}
