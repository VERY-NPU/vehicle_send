/*!
 * search_news.mjs — 装甲车辆新闻采集
 * 策略: NewsAPI (免费 500次/天) + 防务网站 RSS 兜底
 *
 * 需要 GitHub Secret: NEWSAPI_KEY (从 https://newsapi.org 免费注册)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_FILE = path.join(ROOT, 'data.json');
const MAX_AGE_HOURS = 168;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';

// ─── 关键词 ──────────────────────────────────────
const ARMOR_KEYWORDS = /坦克|装甲|步兵战车|自行炮|榴弹炮|火炮|火箭炮|迫击炮|主战坦克|tank|armored|howitzer|artillery|MLRS|IFV|APC|self-propelled|mortar|AFV|MBT|Leopard|Abrams|T-90|T-14|K2|Challenger|Bradley|Stryker|BMP|Boxer|Patria|Puma|Lynx|CV90|Ajax|Redback|defense|military.vehicle/i;
const EXCLUDE_KEYWORDS = /股票|股市|基金|比特币|加密货币|娱乐|明星|综艺|足球|篮球|电竞|旅游|美食|穿搭|护肤|减肥|星座|运势|养生|房地产|房价|彩票/i;

// ─── 分类 ────────────────────────────────────────
function categorize(title) {
  if (/火炮|榴弹炮|加农炮|迫击炮|火箭炮|自行炮|howitzer|artillery|MLRS|mortar/i.test(title)) return '智能火炮';
  if (/AI|人工智能|无人|自主|智能|autonomous|unmanned|drone|UAV|UGV|robot/i.test(title)) return 'AI+军事';
  if (/中国|PLA|解放军|99式|15式|04式|ZBL|ZBD|ZTZ|Type.?99|Type.?15/i.test(title)) return '国内装甲';
  return '国际动态';
}

// ─── 已有 URL 去重 ───────────────────────────────
const existingUrls = new Set();
function loadExistingData() {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    for (const cat of Object.values(data)) {
      if (Array.isArray(cat)) {
        for (const item of cat) if (item.url) existingUrls.add(item.url);
      }
    }
  } catch (e) { console.error('[search] 加载已有数据失败:', e.message); }
}

// ─── RSS/XML 解析 ─────────────────────────────────
function parseFeedRSS(xmlText) {
  const items = [];
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = blockRe.exec(xmlText)) !== null) {
    const b = m[1];
    const title = extractTag(b, 'title');
    const url = extractLink(b);
    const pubDate = extractTag(b, 'pubDate') || extractTag(b, 'published') || extractTag(b, 'updated') || extractTag(b, 'dc:date');
    if (title && url) items.push({ title: decodeXml(title), url, pubDate: pubDate || '' });
  }
  return items;
}

function extractTag(xml, tagName) {
  const esc = tagName.replace(/:/g, '\\:');
  const re = new RegExp(`<${esc}[^>]*>([\\s\\S]*?)<\\/${esc}>`, 'i');
  const m2 = xml.match(re);
  if (!m2) return '';
  return m2[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

function extractLink(block) {
  let l = extractTag(block, 'link');
  if (!l) {
    const m2 = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (m2) l = m2[1];
  }
  return l ? l.trim() : '';
}

function decodeXml(t) {
  return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

function isRecent(ds) {
  if (!ds) return true;
  try { const dt = new Date(ds); return isNaN(dt.getTime()) || Date.now() - dt.getTime() <= MAX_AGE_HOURS * 3600000; } catch { return true; }
}

// ─── NewsAPI 搜索 ─────────────────────────────────
async function searchNewsAPI(query, category, lang = 'en') {
  if (!NEWSAPI_KEY) {
    console.error('[NewsAPI] 未配置 NEWSAPI_KEY');
    return [];
  }
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&pageSize=10&sortBy=publishedAt&language=${lang}&apiKey=${NEWSAPI_KEY}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'WangYe/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error('[NewsAPI] HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (data.status !== 'ok') {
      console.error('[NewsAPI] status:', data.status, data.message);
      return [];
    }
    return data.articles.map(a => ({
      title: a.title || '',
      url: a.url || '',
      source: 'NewsAPI',
      pubDate: a.publishedAt || '',
      category,
    }));
  } catch (e) {
    console.error('[NewsAPI] fetch failed:', e.message);
    return [];
  }
}

// ─── 防务网站 RSS ─────────────────────────────────
const RSS_SOURCES = [
  { name: 'Defense News',  url: 'https://www.defensenews.com/arc/outboundfeeds/v2/category/land/?outputType=xml', defaultCat: '国际动态' },
  { name: 'Military.com',  url: 'https://www.military.com/rss/equipment.xml', defaultCat: '国际动态' },
];

async function fetchRSS(srcName, srcUrl, defaultCat) {
  const res = await fetch(srcUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WangYe/1.0)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return parseFeedRSS(xml).map(it => ({ ...it, source: srcName, category: defaultCat }));
}

// ─── 主流程 ──────────────────────────────────────
async function main() {
  loadExistingData();
  console.error('[search] 已有:', existingUrls.size, '篇');

  const all = [];
  const seen = new Set();

  // 第一阶段: NewsAPI 搜索（主力 — 英文 + 中文双源）
  const newsapiQueries = [
    // 英文源
    { q: '"armored vehicle" OR "main battle tank" OR howitzer OR "self-propelled artillery"', cat: '智能火炮', lang: 'en' },
    { q: '"AI military" OR "autonomous combat vehicle" OR "unmanned ground vehicle" defense', cat: 'AI+军事', lang: 'en' },
    { q: '"tank" OR "armored" OR "artillery" OR "IFV" OR "APC" military', cat: '国际动态', lang: 'en' },
    // 中文源
    { q: '坦克 OR 装甲车 OR 自行火炮 OR 榴弹炮 OR 步兵战车', cat: '智能火炮', lang: 'zh' },
    { q: '人工智能 军事 OR 无人战车 OR AI 武器', cat: 'AI+军事', lang: 'zh' },
  ];

  for (const { q, cat, lang } of newsapiQueries) {
    console.error('[NewsAPI', lang.toUpperCase(), ']', q.substring(0, 50));
    const articles = await searchNewsAPI(q, cat, lang);
    console.error('  原始:', articles.length);
    let matched = 0;
    for (const a of articles) {
      if (seen.has(a.url) || existingUrls.has(a.url)) continue;
      if (a.title.length < 10) continue;
      if (!ARMOR_KEYWORDS.test(a.title)) continue;
      if (EXCLUDE_KEYWORDS.test(a.title)) continue;
      if (!isRecent(a.pubDate)) continue;
      seen.add(a.url);
      matched++;
      all.push(a);
    }
    console.error('  匹配:', matched);
  }

  // 第二阶段: 防务 RSS 兜底
  for (const src of RSS_SOURCES) {
    console.error('[RSS]', src.name);
    try {
      const items = await fetchRSS(src.name, src.url, src.defaultCat);
      console.error('  原始:', items.length);
      let matched = 0;
      for (const it of items) {
        if (seen.has(it.url) || existingUrls.has(it.url)) continue;
        if (it.title.length < 8) continue;
        if (!ARMOR_KEYWORDS.test(it.title)) continue;
        if (EXCLUDE_KEYWORDS.test(it.title)) continue;
        if (!isRecent(it.pubDate)) continue;
        seen.add(it.url);
        matched++;
        all.push(it);
      }
      console.error('  匹配:', matched);
    } catch (e) {
      console.error('  失败:', e.message);
    }
  }

  const stats = {};
  for (const r of all) stats[r.category] = (stats[r.category] || 0) + 1;
  console.error('[search] 新文章:', all.length, Object.entries(stats).map(([k, v]) => k + ':' + v).join(' '));

  process.stdout.write(JSON.stringify({ results: all }));
}

main().catch(e => {
  console.error('[search] FATAL:', e.message);
  process.stdout.write(JSON.stringify({ results: [] }));
});
