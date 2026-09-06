#!/usr/bin/env node
/**
 * scripts/process-images.mjs
 *
 * Convert raw generated images (raw/<ID>.png|jpg|webp) into the final
 * images/<ID>__<slug>.webp files, downscaling to a max long edge (default 1536),
 * keeping aspect ratio, never upscaling, WebP quality 85 (or 80 if the total
 * image size would exceed 200 MB), and writing images/manifest.json.
 *
 * Also writes images/failed.json with any IDs whose processing fails (or that
 * have no raw input).
 *
 * Usage:
 *   node scripts/process-images.mjs [--only=IMG_001,IMG_005] [--force]
 *                                   [--max-edge=1536] [--quality=85]
 *
 * Requirement: raw/<ID>.png (or .jpg/.jpeg/.webp) for each ID to process.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PROMPTS_PATH = resolve(ROOT, 'public/prompts.json');
const RAW_DIR = resolve(ROOT, 'raw');
const IMAGES_DIR = resolve(ROOT, 'images');
const MANIFEST_PATH = resolve(IMAGES_DIR, 'manifest.json');
const FAILED_PATH = resolve(IMAGES_DIR, 'failed.json');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const only = new Set((arg('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const force = process.argv.includes('--force');
// Whether a negative prompt was actually applied by the generator.
// The built-in image tool has no separate negative-prompt parameter,
// so pass --negative-applied only for generators/APIs that support it.
const negativeApplied = process.argv.includes('--negative-applied');
const MAX_LONG_EDGE = Number(arg('max-edge', '1536'));
const QUALITY = Number(arg('quality', '85'));
const TOTAL_BUDGET = 200 * 1024 * 1024; // 200 MB

const prompts = JSON.parse(readFileSync(PROMPTS_PATH, 'utf8'));
const byId = new Map(prompts.map((p) => [p.id, p]));
mkdirSync(RAW_DIR, { recursive: true });
mkdirSync(IMAGES_DIR, { recursive: true });

function slugFromPrompt(prompt, words = 6, maxLength = 60) {
  return prompt
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .slice(0, words)
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
}

function findRaw(id) {
  const exts = ['.png', '.jpg', '.jpeg', '.webp', '.jxl'];
  for (const ext of exts) {
    const p = resolve(RAW_DIR, id + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

const failed = [];
const items = [];
const sorted = [...prompts].sort((a, b) => a.index - b.index);

for (const { id, prompt, negative_prompt } of sorted) {
  if (only.size > 0 && !only.has(id)) continue;

  const rawPath = findRaw(id);
  const explicit = only.size > 0 && only.has(id);
  const slug = slugFromPrompt(prompt);
  const filename = `${id}__${slug}.webp`;
  const outPath = resolve(IMAGES_DIR, filename);

  if (!rawPath) {
    // If the final WebP already exists, keep it in the manifest (idempotent
    // re-run without raw sources). Only record a missing raw input as failure
    // when the ID was explicitly requested AND the output file does not exist.
    if (existsSync(outPath)) {
      const meta = await sharp(outPath).metadata();
      items.push({
        id,
        filename,
        prompt,
        negative_prompt,
        negative_prompt_applied: negativeApplied,
        width: meta.width,
        height: meta.height,
        bytes: statSync(outPath).size,
        created_at: statSync(outPath).mtime.toISOString(),
      });
      console.log(`KEEP ${id} -> ${filename} (existing file kept)`);
      continue;
    }
    if (explicit) {
      failed.push({ id, error: 'no raw input found (raw/<ID>.png|jpg|webp)', created_at: new Date().toISOString() });
    }
    continue;
  }

  try {
    if (!force && existsSync(outPath)) {
      const meta = await sharp(outPath).metadata();
      items.push({
        id,
        filename,
        prompt,
        negative_prompt,
        negative_prompt_applied: negativeApplied,
        width: meta.width,
        height: meta.height,
        bytes: statSync(outPath).size,
        created_at: statSync(outPath).mtime.toISOString(),
      });
      continue;
    }

    const inputMeta = await sharp(rawPath).metadata();
    const srcW = inputMeta.width ?? 0;
    const srcH = inputMeta.height ?? 0;
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(srcW, srcH));
    const width = Math.round(srcW * scale);
    const height = Math.round(srcH * scale);

    const info = await sharp(rawPath)
      .resize({ width, height, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toFile(outPath);

    items.push({
      id,
      filename,
      prompt,
      negative_prompt,
      negative_prompt_applied: negativeApplied,
      width: info.width,
      height: info.height,
      bytes: info.size,
      created_at: new Date().toISOString(),
    });
    console.log(`OK   ${id} -> ${filename} (${info.width}x${info.height}, ${info.size} bytes)`);
  } catch (err) {
    failed.push({ id, error: String(err?.message ?? err), created_at: new Date().toISOString() });
    console.error(`FAIL ${id}: ${err?.message ?? err}`);
  }
}

let totalBytes = items.reduce((acc, it) => acc + it.bytes, 0);
let quality = QUALITY;
let maxEdge = MAX_LONG_EDGE;
if (totalBytes > TOTAL_BUDGET) {
  quality = 80;
  maxEdge = 1280;
  console.warn(`WARN: total ${(totalBytes / 1024 / 1024).toFixed(1)} MB > 200 MB -> re-processing all at quality=${quality}, max-edge=${maxEdge}`);
  // Re-run every currently-known item at the downgraded settings.
  totalBytes = 0;
  for (const it of [...items]) {
    const rawPath = findRaw(it.id);
    if (!rawPath) continue;
    try {
      const meta = await sharp(rawPath).metadata();
      const scale = Math.min(1, maxEdge / Math.max(meta.width ?? 0, meta.height ?? 0));
      const info = await sharp(rawPath)
        .resize({ width: Math.round((meta.width ?? 0) * scale), height: Math.round((meta.height ?? 0) * scale), fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(resolve(IMAGES_DIR, it.filename));
      it.width = info.width;
      it.height = info.height;
      it.bytes = info.size;
      totalBytes += info.size;
      console.log(`RE-OK ${it.id} -> ${it.filename} (${info.width}x${info.height}, ${info.size} bytes)`);
    } catch (err) {
      console.error(`RE-FAIL ${it.id}: ${err?.message ?? err}`);
    }
  }
}

const manifest = {
  generated_at: new Date().toISOString(),
  generator: process.env.IMAGE_GENERATOR || 'Arena.ai built-in image generation tool (OpenAI-compatible image model, direct generation, no external API key)',
  quality,
  max_long_edge: maxEdge,
  items,
};
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(FAILED_PATH, JSON.stringify(failed, null, 2) + '\n');

console.log('--- process-images.mjs report ---');
console.log(`Processed: ${items.length}, failed: ${failed.length}`);
console.log(`Manifest: ${MANIFEST_PATH}`);
console.log(`Failed:   ${FAILED_PATH}`);
console.log(`Total images size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB (quality ${quality}, max edge ${maxEdge})`);
