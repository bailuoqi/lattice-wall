#!/usr/bin/env node
// Purity gate for the packaged sandbox files (SPEC §11): run after `npm run build`.
// Usage: node scripts/verify-purity.mjs [srcDir]
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srcRoot = resolve(process.argv[2] ?? resolve(root, 'src'));

const ALLOWED_EXTENSIONS = new Set(['.html', '.css', '.js']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const PANEL_SCRIPT_TARGET_BYTES = 200 * 1024;
// Files the host injects into the panel document; they are referenced but never packaged.
const HOST_INJECTED_FILES = new Set(['__bridge__.js']);

const FORBIDDEN_EVERYWHERE = [
  ['fetch(', /\bfetch\s*\(/gi],
  ['XMLHttpRequest', /xmlhttprequest/gi],
  ['WebSocket', /websocket/gi],
  ['eval(', /\beval\s*\(/gi],
  ['new Function', /\bnew\s+Function\b/g],
  ['Function(', /\bFunction\s*\(/g],
  ['importScripts', /importscripts/gi],
  ['http://', /http:\/\//gi],
  ['https://', /https:\/\//gi],
  ['ws://', /\bws:\/\//gi],
  ['wss://', /\bwss:\/\//gi],
  ['javascript: URL', /javascript:/gi],
];

const FORBIDDEN_IN_HTML = [
  ['<base>', /<base\b/gi],
  ['<iframe>', /<iframe\b/gi],
  ['<object>', /<object\b/gi],
  ['<embed>', /<embed\b/gi],
  ['inline event handler', /\son[a-z]+\s*=/gi],
];

const BARE_FILENAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

const formatBytes = (bytes) => (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const snippet = (text, index, length) => text.slice(Math.max(0, index - 20), index + length + 20).replace(/\s+/g, ' ').trim();

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function scanPatterns(text, rules, report) {
  for (const [id, pattern] of rules) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      report(lineOf(text, match.index), `forbidden ${id}`, snippet(text, match.index, match[0].length));
    }
  }
}

function scanHtml(text, existing, report) {
  for (const match of text.matchAll(/<script\b([^>]*)>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1])) report(lineOf(text, match.index), 'inline <script>', snippet(text, match.index, match[0].length));
  }
  for (const match of text.matchAll(/\b(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    const where = lineOf(text, match.index);
    if (/^data:/i.test(value) || value.startsWith('#')) continue;
    if (!BARE_FILENAME.test(value)) {
      report(where, `${match[1]} is not a bare relative filename`, value);
      continue;
    }
    if (!HOST_INJECTED_FILES.has(value) && !existing.has(value)) {
      report(where, `${match[1]} references a file missing from the package`, value);
    }
  }
  scanPatterns(text, FORBIDDEN_IN_HTML, report);
}

function scanCss(text, report) {
  for (const match of text.matchAll(/@import\b/gi)) report(lineOf(text, match.index), 'forbidden @import', snippet(text, match.index, 7));
  for (const match of text.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (/^data:/i.test(value) || value.startsWith('#')) continue;
    report(lineOf(text, match.index), 'url() must be a data: URI or fragment', value.slice(0, 80));
  }
}

async function main() {
  let files;
  try {
    files = await listFiles(srcRoot);
  } catch {
    console.log(`verify-purity: cannot read ${srcRoot}`);
    return 1;
  }
  if (files.length === 0) {
    console.log(`verify-purity: ${srcRoot} contains no files (run \`npm run build\` first)`);
    return 1;
  }

  const violations = [];
  const warnings = [];
  const rows = [];
  const existing = new Set(files.map((path) => relative(srcRoot, path).split(sep).join('/')));
  let total = 0;

  for (const path of files) {
    const name = relative(srcRoot, path).split(sep).join('/');
    const size = (await stat(path)).size;
    total += size;
    const before = violations.length;
    const report = (line, rule, detail) => violations.push({ name, line, rule, detail });
    const extension = extname(name).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) report(0, 'file type not allowed (only .html/.css/.js)', extension || '(none)');
    if (size >= MAX_FILE_BYTES) report(0, `file exceeds ${formatBytes(MAX_FILE_BYTES)}`, formatBytes(size));
    if (name === 'panel.js' && size > PANEL_SCRIPT_TARGET_BYTES) warnings.push(`panel.js is ${formatBytes(size)}, above the ${formatBytes(PANEL_SCRIPT_TARGET_BYTES)} target`);

    if (ALLOWED_EXTENSIONS.has(extension)) {
      const text = await readFile(path, 'utf8');
      scanPatterns(text, FORBIDDEN_EVERYWHERE, report);
      if (extension === '.html') scanHtml(text, existing, report);
      if (extension === '.css') scanCss(text, report);
    }
    const count = violations.length - before;
    rows.push([name, formatBytes(size), count === 0 ? 'ok' : `${count} violation${count === 1 ? '' : 's'}`]);
  }

  if (total >= MAX_TOTAL_BYTES) violations.push({ name: '(package)', line: 0, rule: `package exceeds ${formatBytes(MAX_TOTAL_BYTES)}`, detail: formatBytes(total) });
  rows.push(['(total)', formatBytes(total), violations.length === 0 ? 'ok' : 'FAIL']);

  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column].length), ['file', 'size', 'status'][column].length));
  const line = (row) => row.map((cell, column) => cell.padEnd(widths[column])).join('  ');
  console.log(`verify-purity: ${relative(root, srcRoot) || '.'}`);
  console.log(line(['file', 'size', 'status']));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));

  // Everything goes to stdout so the table and the findings never interleave out of order.
  for (const warning of warnings) console.log(`warning: ${warning}`);
  if (violations.length > 0) {
    console.log(`\n${violations.length} violation${violations.length === 1 ? '' : 's'}:`);
    for (const violation of violations) {
      const location = violation.line > 0 ? `${violation.name}:${violation.line}` : violation.name;
      console.log(`  ${location}: ${violation.rule}${violation.detail ? ` — ${violation.detail}` : ''}`);
    }
    return 1;
  }
  console.log('\nOK: no network access, no dynamic code, no external references.');
  return 0;
}

process.exitCode = await main();
