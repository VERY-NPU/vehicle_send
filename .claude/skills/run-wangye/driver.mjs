#!/usr/bin/env node

/**
 * WangYe - 装甲车辆每日资讯 驱动脚本
 *
 * 用法:
 *   node driver.mjs generate < news.json       # 从 JSON 生成 HTML
 *   node driver.mjs deploy                     # 部署到 GitHub Pages
 *   node driver.mjs push <title> <url> [desc]  # 推送微信通知
 *   node driver.mjs daily                      # 每日自动流程 (generate + archive + deploy + push)
 *   node driver.mjs archive                    # 手动归档今日页面
 *   node driver.mjs cleanup                    # 清理超过365天的旧存档
 *   node driver.mjs serve                      # 本地预览
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DOCS = resolve(ROOT, 'docs');
const TEMPLATE = resolve(__dirname, 'template.html');
const ARCHIVE_DIR = resolve(DOCS, 'archive');

/* ============================================================
   Helpers
   ============================================================ */

function log(msg) { console.log(`[wangye] ${msg}`); }

function now() {
  const d = new Date();
  const opts = { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
                 hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  return new Intl.DateTimeFormat('zh-CN', opts).format(d);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ============================================================
   Year Archive System — keep 365 days, favorited items in localStorage survive
   ============================================================ */

function archiveToday(htmlPath) {
  if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dest = resolve(ARCHIVE_DIR, `${key}.html`);
  const html = readFileSync(htmlPath, 'utf8');
  writeFileSync(dest, `<!-- Archived ${now()} -->\n${html}`, 'utf8');
  log(`Archived: ${key}.html`);
  return key;
}

function cleanupArchive() {
  if (!existsSync(ARCHIVE_DIR)) { log('No archive directory yet.'); return 0; }
  const files = readdirSync(ARCHIVE_DIR).filter(f => f.endsWith('.html'));
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const f of files) {
    const match = f.match(/^(\d{4})-(\d{2})-(\d{2})\.html$/);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}-${match[2]}-${match[3]}`).getTime();
    if (fileDate < cutoff) {
      unlinkSync(resolve(ARCHIVE_DIR, f));
      removed++;
      log(`  Removed: ${f} (older than 365 days)`);
    }
  }
  log(`Archive cleanup: ${removed} files removed, ${files.length - removed} remaining`);
  return removed;
}

/* ============================================================
   News Item Builder
   ============================================================ */

function makeId(item) {
  const today = new Date().toISOString().slice(0, 10);
  const h = simpleHash(item.url || item.title || '');
  return `${today}-${h}`;
}

function simpleHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36).slice(0, 6);
}

function makeItem(item, isAi = false) {
  const tag = item.tag || item.category || '综合';
  const imgHtml = item.image
    ? `<img src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy">`
    : getCategoryIcon(item.category || tag);
  const tagClass = isAi ? 'tag ai-tag' : 'tag';
  const id = makeId(item);
  return `
    <div class="news-item" data-id="${id}" data-title="${escapeHtml(item.title)}" data-url="${escapeHtml(item.url || '#')}" data-summary="${escapeHtml(item.summary || item.description || '')}" data-source="${escapeHtml(item.source || item.from || '网络')}" data-category="${escapeHtml(tag)}" data-image="${escapeHtml(item.image || '')}">
      <div class="thumb">${imgHtml}</div>
      <div class="info">
        <span class="${tagClass}">${escapeHtml(tag)}</span>
        <h3><a href="${item.url || '#'}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
        <div class="summary">${escapeHtml(item.summary || item.description || '')}</div>
        <div class="meta-row">
          <span>${escapeHtml(item.source || item.from || '网络')}</span>
          <a href="${item.url || '#'}" target="_blank" rel="noopener">阅读原文 →</a>
        </div>
      </div>
      <button class="fav-btn" onclick="toggleFav(this)" title="点击收藏">☆</button>
    </div>`;
}

function getCategoryIcon(category) {
  const icons = {
    '坦克': '🏗️', 'tank': '🏗️',
    '火炮': '🔫', 'artillery': '🔫',
    '装甲车': '🚛', 'afv': '🚛', '装甲车辆': '🚛',
    'ai': '🤖', 'AI': '🤖', '人工智能': '🤖',
    '综合': '📋',
  };
  return `<span style="font-size:1.4em;">${icons[category] || '📰'}</span>`;
}

/* ============================================================
   Generate HTML
   ============================================================ */

function generateHTML(data) {
  log('Generating HTML from template...');

  if (!existsSync(TEMPLATE)) throw new Error(`Template not found: ${TEMPLATE}`);
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  let html = readFileSync(TEMPLATE, 'utf8');
  const updateTime = now();

  const cnAll = data.cn || [];
  const intAll = data.int || [];
  const aiAll = data.ai || [];

  const cnAiItems = cnAll.filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主','智能']));
  const intAiItems = intAll.filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主','智能']));
  const allAiItems = [...aiAll, ...cnAiItems, ...intAiItems];
  const seenAis = new Set();
  const dedupedAi = allAiItems.filter(i => {
    const k = i.url || i.title;
    if (seenAis.has(k)) return false;
    seenAis.add(k);
    return true;
  });

  const cats = {
    cn_tank:   cnAll.filter(i => matchesCategory(i, ['tank','坦克'])),
    cn_artillery: cnAll.filter(i => matchesCategory(i, ['artillery','artillery','火炮','榴弹炮','火箭炮'])),
    cn_afv:    cnAll.filter(i => matchesCategory(i, ['afv','装甲车','装甲车辆','步战车','步兵战车','输送车'])),
    cn_ai:     cnAiItems,
    int_tank:  intAll.filter(i => matchesCategory(i, ['tank','坦克'])),
    int_artillery: intAll.filter(i => matchesCategory(i, ['artillery','artillery','火炮','榴弹炮','火箭炮'])),
    int_afv:   intAll.filter(i => matchesCategory(i, ['afv','装甲车','装甲车辆','步战车','步兵战车','输送车'])),
    int_ai:    intAiItems,
  };

  function fill(key, items, isAi = false) {
    const upper = key.toUpperCase();
    if (items.length > 0) {
      templateData[`${upper}_ITEMS`] = items.map(i => makeItem(i, isAi || (key === 'ai'))).join('\n');
      templateData[`${upper}_EMPTY`] = '';
    } else {
      templateData[`${upper}_ITEMS`] = '';
      templateData[`${upper}_EMPTY`] = `<div class="empty-state">📭 暂无相关资讯</div>`;
    }
  }

  const templateData = {};
  fill('ai', dedupedAi, true);
  fill('cn_all', cnAll);
  fill('cn_tank', cats.cn_tank);
  fill('cn_artillery', cats.cn_artillery);
  fill('cn_afv', cats.cn_afv);
  fill('cn_ai', cats.cn_ai, true);
  fill('int_all', intAll);
  fill('int_tank', cats.int_tank);
  fill('int_artillery', cats.int_artillery);
  fill('int_afv', cats.int_afv);
  fill('int_ai', cats.int_ai, true);

  for (const [key, value] of Object.entries(templateData)) {
    html = html.split(`{{${key}}}`).join(value);
  }
  html = html.split('{{UPDATE_TIME}}').join(updateTime);

  const outPath = resolve(DOCS, 'index.html');
  writeFileSync(outPath, html, 'utf8');
  log(`HTML written to ${outPath} (${html.length} bytes)`);
  return outPath;
}

function matchesCategory(item, keywords) {
  const text = [item.title, item.summary, item.description, item.category, item.tag, item.content]
    .filter(Boolean).join(' ').toLowerCase();
  return keywords.some(kw => text.includes(kw.toLowerCase()));
}

/* ============================================================
   Deploy to GitHub Pages
   ============================================================ */

function deploy() {
  log('Deploying to GitHub Pages...');

  if (!existsSync(resolve(ROOT, '.git'))) {
    log('Initializing git repository...');
    execSync('git init', { cwd: ROOT, stdio: 'inherit' });
    execSync('git checkout -b main', { cwd: ROOT, stdio: 'inherit' });
  }

  try {
    execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    log('No git remote configured. Set one up:');
    log('  git remote add origin https://github.com/VERY-NPU/vehicle_send.git');
    return false;
  }

  try {
    execSync('git add docs/', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "auto: update armor news ${now()}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push origin main', { cwd: ROOT, stdio: 'inherit' });
    log('✅ Deployed successfully!');
    return true;
  } catch (e) {
    log(`Deploy failed: ${e.message}`);
    return false;
  }
}

/* ============================================================
   Push notification via Server Chan
   ============================================================ */

async function pushNotify(title, url, desc) {
  const key = process.env.SERVER_CHAN_KEY;
  if (!key) {
    log('⚠️  SERVER_CHAN_KEY not set. Skipping push notification.');
    log('    Get a key at https://sct.ftqq.com and set:');
    log('    export SERVER_CHAN_KEY=your_key_here');
    return false;
  }

  const payload = { title: title || '装甲车辆每日资讯已更新', url: url || '', channel: '9' };
  if (desc) payload.desp = desc;

  try {
    const resp = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (result.code === 0) { log('✅ Push notification sent!'); return true; }
    else { log(`⚠️  Push failed: ${result.message}`); return false; }
  } catch (e) { log(`⚠️  Push error: ${e.message}`); return false; }
}

/* ============================================================
   Daily auto run
   ============================================================ */

async function daily() {
  log('=== WangYe Daily Auto Run ===');

  const dataPath = resolve(ROOT, 'data.json');
  let data;
  if (existsSync(dataPath)) {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } else {
    log('No data.json found. Creating placeholder...');
    data = { ai: [], cn: [], int: [], generated_at: now() };
    writeFileSync(dataPath, JSON.stringify(data, null, 2));
  }

  // 1. Generate HTML
  const htmlPath = generateHTML(data);

  // 2. Archive today's page
  archiveToday(htmlPath);

  // 3. Cleanup old archives (>365 days)
  cleanupArchive();

  // 4. Deploy
  const deployed = deploy();

  // 5. Push notification
  if (deployed) {
    let siteUrl = '';
    try {
      const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
      const match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
      if (match) siteUrl = `https://${match[1]}.github.io/${match[2]}/`;
    } catch {}
    const newsCount = (data.ai?.length || 0) + (data.cn?.length || 0) + (data.int?.length || 0);
    await pushNotify(
      `🚀 装甲车辆资讯 · ${newsCount} 条更新`,
      siteUrl,
      `AI专题 ${data.ai?.length || 0} 条 · 国内 ${data.cn?.length || 0} 条 · 国际 ${data.int?.length || 0} 条`
    );
  }

  log('=== Daily run complete ===');
}

/* ============================================================
   Serve locally
   ============================================================ */

function serve() {
  log('Starting local server...');
  execSync('npx serve docs -p 3000', { cwd: ROOT, stdio: 'inherit' });
}

/* ============================================================
   CLI
   ============================================================ */

async function main() {
  const cmd = process.argv[2];

  switch (cmd) {
    case 'generate': {
      const json = await readStdin();
      generateHTML(JSON.parse(json));
      break;
    }
    case 'archive': {
      const htmlPath = resolve(DOCS, 'index.html');
      archiveToday(htmlPath);
      break;
    }
    case 'cleanup':
      cleanupArchive();
      break;
    case 'deploy':
      deploy();
      break;
    case 'push': {
      await pushNotify(process.argv[3] || '装甲车辆资讯更新', process.argv[4] || '', process.argv[5] || '');
      break;
    }
    case 'daily':
      await daily();
      break;
    case 'serve':
      serve();
      break;
    default:
      console.log(`
WangYe - 装甲车辆每日资讯 驱动脚本

用法:
  Generate:  echo '{...news data...}' | node driver.mjs generate
  Archive:   node driver.mjs archive
  Cleanup:   node driver.mjs cleanup
  Deploy:    node driver.mjs deploy
  Push:      node driver.mjs push <title> <url> [description]
  Daily:     node driver.mjs daily    (generate + archive + cleanup + deploy + push)
  Serve:     node driver.mjs serve

环境变量:
  SERVER_CHAN_KEY    Server 酱推送密钥 (可选, 用于微信推送)
`);
  }
}

main().catch(e => {
  console.error('[wangye] Error:', e.message);
  process.exit(1);
});