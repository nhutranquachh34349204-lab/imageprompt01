#!/usr/bin/env node
/**
 * scripts/parse-prompts.mjs
 *
 * Parse the prompt source file (default: 08_prompts_for_manual_image_generation.txt)
 * into public/prompts.json.
 *
 * Expected block layout (tolerates missing/extra blank lines, CRLF, whitespace,
 * missing NEGATIVE PROMPT, and a final block that does not end in a blank line):
 *
 *   === IMG_XXX ===
 *   <prompt...>
 *
 *   NEGATIVE PROMPT:
 *   <negative prompt...>
 *
 * Usage:
 *   node scripts/parse-prompts.mjs [--source=path] [--out=path]
 *
 * Exit code 0 on success (warnings are still printed), 1 on fatal errors.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SOURCE = resolve(ROOT, arg('source', '08_prompts_for_manual_image_generation.txt'));
const OUTPUT = resolve(ROOT, arg('out', 'public/prompts.json'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip diacritics (Vietnamese + other Latin) and collapse whitespace. */
function normalizeText(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .replace(/\s+/g, ' ')
    .trim();
}

/** Slug from the first `words` words of a prompt (lowercase, no diacritics). */
export function slugFromPrompt(prompt, words = 6, maxLength = 60) {
  return normalizeText(prompt)
    .toLowerCase()
    .split(/\s+/)
    .slice(0, words)
    .join('-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const raw = readFileSync(SOURCE, 'utf8').replace(/\r\n?/g, '\n');
const lines = raw.split('\n');
const headerRe = /^\s*===\s*(IMG_[A-Za-z0-9_]+)\s*===\s*$/;

const blocks = []; // { id, rawLines: string[] }
let current = null;

for (const line of lines) {
  const match = headerRe.exec(line);
  if (match) {
    current = { id: match[1].trim(), body: [] };
    blocks.push(current);
    continue;
  }
  if (current) current.body.push(line);
  // Lines before the first header are ignored.
}

const issues = [];
const items = [];
const seen = new Set();

for (let i = 0; i < blocks.length; i++) {
  const block = blocks[i];
  if (seen.has(block.id)) {
    issues.push(`WARN: duplicate ID ${block.id} at block index ${i + 1}`);
  }
  seen.add(block.id);

  const bodyLines = block.body;
  const negIdx = bodyLines.findIndex((l) => /^\s*NEGATIVE\s+PROMPT\s*:/.test(l));

  let prompt = '';
  let negative = '';

  if (negIdx === -1) {
    issues.push(`WARN: ${block.id} is missing NEGATIVE PROMPT (negative_prompt set to "")`);
    prompt = normalizeText(bodyLines.filter((l) => l.trim() !== '').join(' '));
  } else {
    prompt = normalizeText(bodyLines.slice(0, negIdx).filter((l) => l.trim() !== '').join(' '));
    negative = normalizeText(bodyLines.slice(negIdx + 1).filter((l) => l.trim() !== '').join(' '));
  }

  if (!prompt) {
    issues.push(`WARN: ${block.id} has an empty main prompt`);
  }

  items.push({ id: block.id, prompt, negative_prompt: negative, index: i + 1 });
}

// Contiguity / ordering warnings
const numRe = /^IMG_(\d+)$/;
const nums = items
  .map((it) => {
    const m = numRe.exec(it.id);
    return m ? Number(m[1]) : null;
  })
  .filter((n) => n !== null);

if (nums.length && nums.some((n, i) => i > 0 && n !== nums[i - 1] + 1)) {
  issues.push(
    `WARN: IDs are not contiguous/ordered: ${nums
      .map((n, i) => (i > 0 && n !== nums[i - 1] + 1 ? `\n  gap/out-of-order before IMG_${String(n).padStart(3, '0')}` : ''))
      .join('')
      .trim()}`
  );
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(items, null, 2) + '\n');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const missingNeg = items.filter((it) => !it.negative_prompt).map((it) => it.id);
console.log('--- parse-prompts.mjs report ---');
console.log(`Source: ${SOURCE}`);
console.log(`Total blocks: ${items.length}`);
console.log(`First ID: ${items[0]?.id ?? '(none)'}`);
console.log(`Last ID: ${items[items.length - 1]?.id ?? '(none)'}`);
console.log(
  `Missing negative prompt (${missingNeg.length}): ${missingNeg.length ? missingNeg.join(', ') : 'none'}`
);
if (issues.length) {
  console.log('Warnings:');
  for (const w of issues) console.log(`  ${w}`);
} else {
  console.log('Warnings: none');
}
console.log(`Output: ${OUTPUT} (${items.length} items)`);

if (items.length === 0) {
  console.error('FATAL: no blocks parsed.');
  process.exit(1);
}
