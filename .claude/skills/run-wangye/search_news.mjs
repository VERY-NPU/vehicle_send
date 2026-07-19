/*!
 * search_news.mjs — 从军事防务网站 RSS 采集装甲车辆相关新闻
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

// ─── RSS 源 ──────────────────────────────────────
const RSS_SOURCES = [
  // ── 国际防务 RSS（免费，无需 API Key）──
  {
    name: 'Defense News - Land',
    url: 'https://www.defensenews.com/arc/outboundfeeds/v2/category/land/?outputType=xml',
    lang: 'en',
    defaultCat: '国际动态',
  },
  {
    name: 'Breaking Defense - Land',
    url: 'https://breakingdefense.com/category/land/feed/',
    lang: 'en',
    defaultCat: '国际动态',
  },
  {
    name: 'Army Technology',
    url: 'https://www.army-technology.com/feed/',
    lang: 'en',
    defaultCat: '国际动态',
  },
  {
    name: 'The Defense Post',
    url: 'https://www.thedefensepost.com/feed/',
    lang: 'en',
    defaultCat: '国际动态',
  },
  {
    name: 'Military.com - Equipment',
    url: 'https://www.military.com/rss/equipment.xml',
    lang: 'en',
    defaultCat: '国际动态',
  },
  // ── 中文军事 RSS ──
  {
    name: '观察者网-军事',
    url: 'https://www.guancha.cn/rss/military.xml',
    lang: 'zh',
    defaultCat: '国内装甲',
  },
  {
    name: '环球网-军事',
    url: 'https://mil.huanqiu.com/rss',
    lang: 'zh',
    defaultCat: '国内装甲',
  },
];

// ─── 关键词过滤（必须包含至少一个装甲车辆相关词）───
const ARMOR_KEYWORDS = /坦克|装甲|步兵战车|自行炮|榴弹炮|火炮|火箭炮|迫击炮|战车|tank|armored|howitzer|artillery|MLRS|IFV|APC|self-propelled|howitzer|mortar|AFV|MBT|infantry.?(fighting|combat)|assault.?(vehicle|gun)/i;

// ─── 排除词（无关内容） ──────────────────────────
const EXCLUDE_KEYWORDS = /股票|股市|基金|比特币|加密货币|娱乐|明星|综艺|足球|篮球|电竞|赛事|旅游|美食|穿搭|护肤|减肥|星座|生肖|运势|养生|房地产|房价/i;

// ─── 分类判定 ────────────────────────────────────
function categorize(title) {
  if (/\u706B\u70AE|\u69B4\u5F39\u70AE|\u52A0\u519C\u70AE|\u8FEB\u51FB\u70AE|\u706B\u7BAD\u70AE|\u81EA\u884C\u70AE|Howitzer|artillery|howitzer|MLRS|mortar|\u70AE\u5C04|\u589E\u7A0B\u5F39|\u6FC0\u5149\u6B66\u5668/i.test(title)) return '\u667A\u80FD\u706B\u70AE';
  if (/AI|\u4EBA\u5DE5\u667A\u80FD|\u65E0\u4EBA|\u81EA\u4E3B|\u667A\u80FD|autonomous|unmanned|drone|UAV|UGV|robot/i.test(title)) return 'AI+\u519B\u4E8B';
  if (/\u4E2D\u56FD|PLA|\u89E3\u653E\u519B|99\u5F0F|15\u5F0F|04\u5F0F|ZBL|ZBD|ZTZ|Type.?99|Type.?15/i.test(title)) return '\u56FD\u5185\u88C5\u7532';
  return '\u56FD\u9645\u52A8\u6001';
}

// ─── 已存在 URL 去重 ─────────────────────────────
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
    console.error('[search] 无法加载已有数据:', e.message);
  }
}

// ─── XML RSS 解析 ─────────────────────────────────
function parseRSS(xml) {
  const items = [];
  // 支持 <item> 和 <entry> (Atom) 两种格式
  const itemRegex = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractLink(block);
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'published') || extractTag(block, 'updated') || extractTag(block, 'dc:date');
    if (title && link) {
      items.push({ title: decodeEntities(title), url: link, pubDate: pubDate || '' });
    }
  }
  return items;
}

function extractTag(xml, tag) {
  const escTag = tag.replace(/:/g, '\\:');
  const re = new RegExp(`<${escTag}[^>]*>([\\s\\S]*?)<\\/${escTag}>`, 'i');
  const m = xml.match(re);
  if (!m) return '';
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}

function extractLink(block) {
  // Try <link>text</link> first
  let link = extractTag(block, 'link');
  // Try <link href="..."/> (Atom format)
  if (!link) {
    const m = block.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (m) link = m[1];
  }
  return link;
}

function decodeEntities(text) {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
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
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WangYeBot/1.0; +https://very-npu.github.io/vehicle_send/)' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        console.error('[search]   HTTP', res.status);
        continue;
      }
      const xml = await res.text();
      const items = parseRSS(xml);
      console.error('[search]   原始', items.length, '条');

      let matched = 0;
      for (const item of items) {
        if (seenUrls.has(item.url) || existingUrls.has(item.url)) continue;
        if (item.title.length < 10) continue;
        // 关键词匹配
        if (!ARMOR_KEYWORDS.test(item.title)) continue;
        // 排除无关
        if (EXCLUDE_KEYWORDS.test(item.title)) continue;
        // 日期
        if (!isRecent(item.pubDate)) continue;

        seenUrls.add(item.url);
        matched++;
        allResults.push({
          title: item.title,
          url: item.url,
          source: src.name,
          pubDate: item.pubDate,
          category: categorize(item.title),
        });
      }
      console.error('[search]   匹配', matched, '条');
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
