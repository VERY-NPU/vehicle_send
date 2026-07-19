/*!
 * search_news.mjs — 从多个 RSS 源采集装甲车辆相关新闻
 *
 * 输出: { results: [{title, url, source, pubDate, category}] }
 * 自动过滤 72 小时前的旧闻 + 与 data.json 中已有 URL 去重
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_FILE = path.join(ROOT, 'data.json');
const MAX_AGE_HOURS = 72;

// ─── RSS 搜索源 ──────────────────────────────────
const RSS_SOURCES = [
  { name: 'GNews 中文-装甲火炮', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('装甲车辆 OR 坦克 OR 自行火炮 OR 装甲车') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { name: 'GNews 中文-军事AI',   url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('人工智能 军事 OR 无人战车 OR AI武器') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { name: 'GNews 英文-装甲',     url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('armored vehicle OR tank OR artillery OR howitzer OR military') + '&hl=en-US&gl=US&ceid=US:en' },
  { name: 'GNews 英文-AI军事',   url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('AI military OR autonomous drone OR unmanned combat vehicle OR defense') + '&hl=en-US&gl=US&ceid=US:en' },
  { name: 'GNews 中文-坦克装甲', url: 'https://news.google.com/rss/search?q=' + encodeURIComponent('主战坦克 OR 步兵战车 OR 装甲突击') + '&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
];

// ─── 分类关键词映射 ─────────────────────────────
const CATEGORY_KEYWORDS = [
  { pattern: /\u706B\u70AE|\u69B4\u5F39\u70AE|\u52A0\u519C\u70AE|\u8FEB\u51FB\u70AE|\u706B\u7BAD\u70AE|\u81EA\u884C\u70AE|Howitzer|artillery|howitzer|MLRS|mortar|\u70AE\u5C04|\u589E\u7A0B\u5F39|\u6FC0\u5149\u6B66\u5668/i, cat: '智能火炮' },
  { pattern: /AI|\u4EBA\u5DE5\u667A\u80FD|\u65E0\u4EBA|\u81EA\u4E3B|\u667A\u80FD|autonomous|unmanned|drone|UAV|UGV|robot/i, cat: 'AI+军事' },
  { pattern: /\u4E2D\u56FD|PLA|\u89E3\u653E\u519B|99\u5F0F|15\u5F0F|04\u5F0F|ZBL|ZBD|ZTZ|Type.?99|Type.?15/i, cat: '国内装甲' },
  { pattern: /\u5766\u514B|\u88C5\u7532|\u6B65\u5175\u6218\u8F66|tank|armored|IFV|APC|M1|Leopard|T-90|T-14|K2|\u6311\u6218\u8005/i, cat: '国际动态' },
];

// ─── 已存在 URL 集合 ─────────────────────────────
const existingUrls = new Set();

function loadExistingData() {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    for (const cat of Object.values(data)) {
      if (Array.isArray(cat)) {
        for (const item of cat) {
          if (item.url) existingUrls.add(item.url);
        }
      }
    }
  } catch (e) {
    console.error('[search] 无法加载已有数据，将不过滤重复:', e.message);
  }
}

// ─── XML 简单解析 ─────────────────────
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      items.push({ title: decodeEntities(title), url: link, pubDate: pubDate || '' });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

function decodeEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

// ─── 分类判断 ────────────────────────────────────
function categorize(title) {
  for (const kw of CATEGORY_KEYWORDS) {
    if (kw.pattern.test(title)) return kw.cat;
  }
  return '国际动态';
}

// ─── 日期过滤 ────────────────────────────────────
function isRecent(pubDateStr) {
  if (!pubDateStr) return true;
  try {
    const d = new Date(pubDateStr);
    if (isNaN(d.getTime())) return true;
    return (Date.now() - d.getTime()) <= MAX_AGE_HOURS * 3600000;
  } catch { return true; }
}

// ─── 主流程 ──────────────────────────────────────
async function main() {
  loadExistingData();
  console.error('[search] 已有文章数:', existingUrls.size);

  const allResults = [];
  const seenUrls = new Set();

  for (const src of RSS_SOURCES) {
    console.error('[search] 搜索:', src.name);
    try {
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WangYeBot/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) { console.error('[search]   HTTP', res.status); continue; }
      const xml = await res.text();
      const items = parseRSSItems(xml);
      console.error('[search]   找到', items.length, '条');

      for (const item of items) {
        if (seenUrls.has(item.url) || existingUrls.has(item.url)) continue;
        if (item.title.length < 8) continue;
        if (!isRecent(item.pubDate)) continue;

        seenUrls.add(item.url);
        const cat = categorize(item.title);
        allResults.push({
          title: item.title,
          url: item.url,
          source: src.name.includes('英文') ? 'Google News (EN)' : 'Google News',
          pubDate: item.pubDate,
          category: cat,
        });
      }
    } catch (e) {
      console.error('[search]   失败:', e.message);
    }
  }

  const stats = {};
  for (const r of allResults) stats[r.category] = (stats[r.category] || 0) + 1;
  console.error('[search] 新文章总计:', allResults.length, Object.entries(stats).map(([k,v]) => k + ':' + v).join(', '));

  process.stdout.write(JSON.stringify({ results: allResults }));
}

main().catch(e => {
  console.error('[search] FATAL:', e.message);
  process.stdout.write(JSON.stringify({ results: [] }));
});
