#! /usr/bin/env node
/*!
 * WangYe "Daily" Driver - 2026 edition.
 *
 * USAGE:
 *   node driver.mjs generate       < in.json
 *   node driver.mjs archive        <YYYY-MM-DD>
 *   node driver.mjs cleanup        --days=365
 *   node driver.mjs deploy
 *   node driver.mjs push           "message"
 *   node driver.mjs daily          < in.json  (archive + generate + deploy + push)
 *   node driver.mjs serve
 *
 * GENERATE:
 *   expects JSON on stdin  { gen: "...", items[...] }
 *   fills the {{RAW_DATA}} and {{UPDATE_TIME}} slots in template.html
 *   writes docs/index.html
 *
 * ARCHIVE:
 *   copies docs/index.html → docs/archive/<date>.html
 *
 * CLEANUP:
 *   deletes archive files older than --days (default 365)
 *
 * DEPLOY (GitHub Pages):
 *   commits & pushes docs/
 *
 * PUSH (ServerChan):
 *   send a WeChat push via ServerChan API
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// ---------- Paths ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DOCS = path.join(ROOT, 'docs');
const ARCHIVE = path.join(DOCS, 'archive');
const INDEX_HTML = path.join(DOCS, 'index.html');
const TEMPLATE = path.join(__dirname, 'template.html');

// ---------- Helpers ----------
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sh(cmd, opts = {}) {
  const defaults = { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' };
  return execSync(cmd, { ...defaults, ...opts }).toString().trim();
}

// ---------- Generate ----------
async function generate() {
  // Read JSON from stdin
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = chunks.join('');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON input:', e.message);
    process.exit(1);
  }

  // Read template
  if (!fs.existsSync(TEMPLATE)) {
    console.error('Template not found:', TEMPLATE);
    process.exit(1);
  }
  let html = fs.readFileSync(TEMPLATE, 'utf-8');

  // Replace placeholders
  const updateTime = data.generated_at || new Date().toISOString().replace('T', ' ').slice(0, 19);
  html = html.replace(/\{\{UPDATE_TIME\}\}/g, updateTime);

  // Replace RAW_DATA - embed JSON directly
  const jsonData = JSON.stringify(data);
  html = html.replace('{{RAW_DATA}}', jsonData);

  // Write output
  ensureDir(DOCS);
  fs.writeFileSync(INDEX_HTML, html, 'utf-8');
  console.log(`✅ docs/index.html generated (${Buffer.byteLength(html, 'utf-8').toLocaleString()} bytes)`);
}

// ---------- Archive ----------
function archive(dateStr) {
  const src = INDEX_HTML;
  if (!fs.existsSync(src)) {
    console.error('index.html not found. Run `generate` first.');
    process.exit(1);
  }
  ensureDir(ARCHIVE);
  const dest = path.join(ARCHIVE, `${dateStr}.html`);
  fs.copyFileSync(src, dest);
  console.log(`📦 Archived → docs/archive/${dateStr}.html`);
}

// ---------- Cleanup ----------
function cleanup(days = 365) {
  if (!fs.existsSync(ARCHIVE)) { console.log('No archives to clean.'); return; }
  const cutoff = Date.now() - days * 86400000;
  let removed = 0;
  const files = fs.readdirSync(ARCHIVE);
  for (const f of files) {
    if (!f.endsWith('.html')) continue;
    const stat = fs.statSync(path.join(ARCHIVE, f));
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(path.join(ARCHIVE, f));
      removed++;
    }
  }
  console.log(`🧹 Cleaned ${removed} archive(s) older than ${days} days`);
}

// ---------- Deploy ----------
function deploy() {
  // cd ROOT
  console.log('🚀 Deploying to GitHub Pages...');
  try {
    sh('git add docs/');
    sh('git commit -m "Daily update: ' + new Date().toISOString().slice(0, 10) + '"');
    sh('git push');
  } catch (e) {
    if (e.message.includes('nothing to commit')) {
      console.log('Nothing to commit.');
    } else {
      console.error('Deploy failed:', e.message);
      process.exit(1);
    }
  }
  console.log('✅ Deployed');
}

// ---------- Push (ServerChan) ----------
function push(titleSuffix, url, description) {
  // Support multiple ServerChan keys: SERVER_CHAN_KEY, SERVER_CHAN_KEY_2, SERVER_CHAN_KEY_3, ...
  const keys = [];
  for (const [key, val] of Object.entries(process.env)) {
    if (key.match(/^SERVER_CHAN_KEY(?:_\d+)?$/i) && val) {
      keys.push({ name: key, value: val });
    }
  }
  if (keys.length === 0) {
    console.error('No SERVER_CHAN_KEY env var set. Skipping push.');
    return;
  }
  const title = encodeURIComponent('🚀 装甲车辆每日资讯更新' + (titleSuffix ? ' - ' + titleSuffix : ''));
  const pageUrl = url || 'https://VERY-NPU.github.io/vehicle_send/';
  const desc = description || '最新装甲车辆资讯已更新，点击查看。';
  const desp = encodeURIComponent(`## ${desc}\n\n👉 [点击查看完整资讯](${pageUrl})`);
  for (const k of keys) {
    try {
      sh(`curl -s "https://sctapi.ftqq.com/${k.value}.send?title=${title}&desp=${desp}"`);
      console.log(`📲 Push sent → ${k.name}`);
    } catch (e) {
      console.error(`Push failed for ${k.name}:`, e.message);
    }
  }
}

// ---------- Daily ----------
async function daily() {
  // Read JSON, generate, archive, deploy, push
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) chunks.push(chunk);

  let data;
  try {
    data = JSON.parse(chunks.join(''));
  } catch (e) {
    console.error('Invalid JSON:', e.message);
    process.exit(1);
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const updateTime = data.generated_at || new Date().toISOString().replace('T', ' ').slice(0, 19);

  // Generate
  let html = fs.readFileSync(TEMPLATE, 'utf-8');
  html = html.replace(/\{\{UPDATE_TIME\}\}/g, updateTime);
  html = html.replace('{{RAW_DATA}}', JSON.stringify(data));
  ensureDir(DOCS);
  fs.writeFileSync(INDEX_HTML, html, 'utf-8');
  console.log(`✅ Generated index.html`);

  // Archive
  ensureDir(ARCHIVE);
  fs.copyFileSync(INDEX_HTML, path.join(ARCHIVE, `${dateStr}.html`));
  console.log(`📦 Archived → ${dateStr}.html`);

  // Cleanup old archives
  cleanup(365);

  // Deploy
  deploy();

  // Push
  push(dateStr);
}

// ---------- Serve ----------
function serve() {
  console.log('Starting dev server on http://localhost:3000');
  try {
    sh('npx serve docs -p 3000', { stdio: 'inherit' });
  } catch (e) {
    // server killed
  }
}

// ---------- CLI dispatch ----------
const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case 'generate':
    await generate();
    break;
  case 'archive':
    if (!arg) { console.error('Usage: driver.mjs archive <YYYY-MM-DD>'); process.exit(1); }
    archive(arg);
    break;
  case 'cleanup':
    cleanup(parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || 365));
    break;
  case 'deploy':
    deploy();
    break;
  case 'push':
    push(arg || '');
    break;
  case 'daily':
    await daily();
    break;
  case 'serve':
    serve();
    break;
  default:
    console.log(`WangYe Driver - Usage:`);
    console.log(`  node driver.mjs generate       < in.json`);
    console.log(`  node driver.mjs archive        <YYYY-MM-DD>`);
    console.log(`  node driver.mjs cleanup        [--days=365]`);
    console.log(`  node driver.mjs deploy`);
    console.log(`  node driver.mjs push           [message]`);
    console.log(`  node driver.mjs daily          < in.json`);
    console.log(`  node driver.mjs serve`);
}
