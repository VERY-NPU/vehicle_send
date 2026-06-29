#!/usr/bin/env node

/**
 * WangYe - 装甲车辆每日资讯 驱动脚本
 *
 * 用法:
 *   node driver.mjs generate < news.json       # 从 JSON 生成 HTML
 *   node driver.mjs deploy                     # 部署到 GitHub Pages
 *   node driver.mjs push <title> <url> [desc]  # 推送微信通知
 *   node driver.mjs daily                      # 每日自动流程 (generate + deploy + push)
 *   node driver.mjs serve                      # 本地预览
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
const DOCS = resolve(ROOT, 'docs');
const TEMPLATE = resolve(__dirname, 'template.html');

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

/* ============================================================
   Card HTML Builder
   ============================================================ */

function makeCard(item, isAi = false) {
  const tag = item.tag || item.category || '综合';
  const imgHtml = item.image
    ? `<img src="${item.image}" alt="${escapeHtml(item.title)}" loading="lazy">`
    : getCategoryIcon(item.category || tag);
  const tagClass = isAi ? 'card-tag ai-tag' : 'card-tag';
  return `
    <div class="news-card">
      <div class="news-card-img">${imgHtml}</div>
      <div class="news-card-body">
        <span class="${tagClass}">${escapeHtml(tag)}</span>
        <h3><a href="${item.url || '#'}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h3>
        <p>${escapeHtml(item.summary || item.description || '')}</p>
        <div class="source">
          <span>${escapeHtml(item.source || item.from || '网络')}</span>
          <a href="${item.url || '#'}" target="_blank" rel="noopener">阅读原文 →</a>
        </div>
      </div>
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
  const icon = icons[category] || '📰';
  return `<span style="font-size:2.5em;">${icon}</span>`;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ============================================================
   Generate HTML
   ============================================================ */

function generateHTML(data) {
  log('Generating HTML from template...');

  if (!existsSync(TEMPLATE)) {
    throw new Error(`Template not found: ${TEMPLATE}`);
  }
  if (!existsSync(DOCS)) mkdirSync(DOCS, { recursive: true });

  let html = readFileSync(TEMPLATE, 'utf8');
  const updateTime = now();

  // Build cards for each section
  const sections = {
    ai: data.ai || [],
    cn_tank: (data.cn || []).filter(i => matchesCategory(i, ['tank','坦克'])),
    cn_artillery: (data.cn || []).filter(i => matchesCategory(i, ['artillery','artillery','火炮','榴弹炮'])),
    cn_afv: (data.cn || []).filter(i => matchesCategory(i, ['afv','装甲车','装甲车辆','步战车','步兵战车'])),
    cn_ai: (data.cn || []).filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主'])),
    int_tank: (data.int || []).filter(i => matchesCategory(i, ['tank','坦克'])),
    int_artillery: (data.int || []).filter(i => matchesCategory(i, ['artillery','artillery','火炮','榴弹炮'])),
    int_afv: (data.int || []).filter(i => matchesCategory(i, ['afv','装甲车','装甲车辆','步战车','步兵战车'])),
    int_ai: (data.int || []).filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主'])),
  };

  // Also tag AI-related items across all sections for the AI special section
  const allAiItems = [
    ...(data.ai || []),
    ...(data.cn || []).filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主','智能'])),
    ...(data.int || []).filter(i => matchesCategory(i, ['ai','AI','人工智能','无人','自主','智能'])),
  ];

  // Deduplicate AI items
  const seenUrls = new Set();
  const dedupedAi = allAiItems.filter(i => {
    const key = i.url || i.title;
    if (seenUrls.has(key)) return false;
    seenUrls.add(key);
    return true;
  });

  const templateData = {};
  const sectionKeys = ['ai','cn_tank','cn_artillery','cn_afv','cn_ai','int_tank','int_artillery','int_afv','int_ai'];

  for (const key of sectionKeys) {
    const items = key === 'ai' ? dedupedAi : sections[key];
    const isAi = key === 'ai';
    if (items.length > 0) {
      templateData[`${key.toUpperCase()}_CARDS`] = items.map(i => makeCard(i, isAi)).join('\n');
      templateData[`${key.toUpperCase()}_EMPTY`] = '';
    } else {
      templateData[`${key.toUpperCase()}_CARDS`] = '';
      templateData[`${key.toUpperCase()}_EMPTY`] = `<div class="empty-state"><div class="icon">📭</div><p>暂无相关资讯</p></div>`;
    }
  }

  // Replace all placeholders
  for (const [key, value] of Object.entries(templateData)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  html = html.replace(/{{UPDATE_TIME}}/g, updateTime);

  const outPath = resolve(DOCS, 'index.html');
  writeFileSync(outPath, html, 'utf8');
  log(`HTML written to ${outPath}`);
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

  // Check if git repo exists, if not initialize
  if (!existsSync(resolve(ROOT, '.git'))) {
    log('Initializing git repository...');
    execSync('git init', { cwd: ROOT, stdio: 'inherit' });
    execSync('git checkout -b main', { cwd: ROOT, stdio: 'inherit' });
  }

  // Check if remote exists
  try {
    const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    log(`Remote: ${remote}`);
  } catch {
    log('No git remote configured. Please set one up:');
    log('  git remote add origin https://github.com/YOUR_USER/wangye.git');
    log('Then run deploy again.');
    return false;
  }

  try {
    execSync('git add docs/index.html', { cwd: ROOT, stdio: 'inherit' });
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

  const payload = {
    title: title || '装甲车辆每日资讯已更新',
    url: url || '',
    channel: '9',  // 服务号消息
  };
  if (desc) payload.desp = desc;

  try {
    const resp = await fetch(`https://sctapi.ftqq.com/${key}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await resp.json();
    if (result.code === 0) {
      log('✅ Push notification sent!');
      return true;
    } else {
      log(`⚠️  Push failed: ${result.message}`);
      return false;
    }
  } catch (e) {
    log(`⚠️  Push error: ${e.message}`);
    return false;
  }
}

/* ============================================================
   Daily auto run
   ============================================================ */

async function daily() {
  log('=== WangYe Daily Auto Run ===');

  // Read news data from data.json if exists
  const dataPath = resolve(ROOT, 'data.json');
  let data;
  if (existsSync(dataPath)) {
    data = JSON.parse(readFileSync(dataPath, 'utf8'));
  } else {
    log('No data.json found. Creating placeholder...');
    data = {
      ai: [],
      cn: [],
      int: [],
      generated_at: now(),
    };
    writeFileSync(dataPath, JSON.stringify(data, null, 2));
  }

  // Generate HTML
  const htmlPath = generateHTML(data);

  // Deploy
  const deployed = deploy();

  // Push notification
  if (deployed) {
    let siteUrl = '';
    try {
      const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
      // Convert git URL to GitHub Pages URL
      const match = remote.match(/github\.com[:/](.+?)\/(.+?)\.git/);
      if (match) {
        siteUrl = `https://${match[1]}.github.io/${match[2].replace('.github.io','')}/`;
      }
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
      const data = JSON.parse(json);
      generateHTML(data);
      break;
    }
    case 'deploy':
      deploy();
      break;
    case 'push': {
      const title = process.argv[3] || '装甲车辆资讯更新';
      const url = process.argv[4] || '';
      const desc = process.argv[5] || '';
      await pushNotify(title, url, desc);
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
  Deploy:    node driver.mjs deploy
  Push:      node driver.mjs push <title> <url> [description]
  Daily:     node driver.mjs daily
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