/*!
 * search_news.mjs — 装甲车辆新闻采集
 * 策略: Bing News RSS (微软→Azure GH Actions 无阻) + 防务网站 RSS 兜底
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_FILE = path.join(ROOT, 'data.json');
const MAX_AGE_HOURS = 168; // 放宽到 7 天（RSS 更新不一定及时）

// ─── 关键词（宽松匹配，确保不漏新闻） ───────────
const ARMOR_KEYWORDS = /坦克|装甲|步兵战车|自行炮|榴弹炮|火炮|火箭炮|迫击炮|战车|主战坦克|tank|armored|howitzer|artillery|MLRS|IFV|APC|self-propelled|mortar|AFV|MBT|Leopard|Abrams|T-90|T-14|K2|Challenger|Bradley|Stryker|BMP|Boxer|Patria|Puma|Lynx|CV90|Ajax|Redback/i;
const EXCLUDE_KEYWORDS = /股票|股市|基金|比特币|加密货币|娱乐|明星|综艺|足球|篮球|电竞|赛事|旅游|美食|穿搭|护肤|减肥|星座|生肖|运势|养生|房地产|房价|天气|彩票/i;

// ─── RSS 源（Bing News 优先） ─────────────────────
const RSS_SOURCES = [
  // Bing News RSS — 微软自有，Azure 零延迟
  { name: 'Bing News-装甲火炮',  url: 'https://www.bing.com/news/search?q=' + encodeURIComponent('坦克 OR 装甲车 OR 自行火炮 OR 榴弹炮') + '&format=rss', defaultCat: '智能火炮' },
  { name: 'Bing News-军事AI',    url: 'https://www.bing.com/news/search?q=' + encodeURIComponent('人工智能 军事 OR 无人战车 OR AI 军事') + '&format=rss', defaultCat: 'AI+军事' },
  { name: 'Bing News-EN tanks',  url: 'https://www.bing.com/news/search?q=' + encodeURIComponent('tank OR armored vehicle OR self-propelled howitzer OR artillery military') + '&format=rss', defaultCat: '国际动态' },
  { name: 'Bing News-EN AI',     url: 'https://www.bing.com/news/search?q=' + encodeURIComponent('AI military OR autonomous combat vehicle OR drone defense') + '&format=rss', defaultCat: 'AI+军事' },
  // 直连防务 RSS 兜底
  { name: 'Defense News',        url: 'https://www.defensenews.com/arc/outboundfeeds/v2/category/land/?outputType=xml', defaultCat: '国际动态' },
  { name: 'Breaking Defense',    url: 'https://breakingdefense.com/category/land/feed/', defaultCat: '国际动态' },
  { name: 'Army Technology',     url: 'https://www.army-technology.com/feed/', defaultCat: '国际动态' },
  { name: 'Military.com',        url: 'https://www.military.com/rss/equipment.xml', defaultCat: '国际动态' },
];

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
function parseFeed(xml) {
  const items = [];
  const blockRe = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = blockRe.exec(xml)) !== null) {
    const b = m[1];
    const title = tag(b, 'title');
    const link = link(b);
    const pubDate = tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date');
    if (title && link) items.push({ title: d(title), url: link, pubDate: pubDate || '' });
  }
  return items;
}

function tag(xml, t) {
  const esc = t.replace(/:/g, '\\:');
  const re = new RegExp(`<${esc}[^>]*>([\\s\\S]*?)<\\/${esc}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() : '';
}

function link(b) {
  let l = tag(b, 'link');
  if (!l) { const m = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i); if (m) l = m[1]; }
  return l;
}

function d(t) { return t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'"); }

function isRecent(ds) {
  if (!ds) return true;
  try { const dt = new Date(ds); return isNaN(dt.getTime()) || Date.now() - dt.getTime() <= MAX_AGE_HOURS * 3600000; } catch { return true; }
}

// ─── 主流程 ──────────────────────────────────────
async function main() {
  loadExistingData();
  console.error('[search] 已有:', existingUrls.size, '篇');

  const all = [];
  const seen = new Set();

  for (const src of RSS_SOURCES) {
    console.error('[search]', src.name, '...');
    try {
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) { console.error('  HTTP', res.status); continue; }
      const xml = await res.text();
      const items = parseFeed(xml);
      console.error('  原始:', items.length);
      if (items.length === 0) {
        // 调试：打印前 300 字符
        console.error('  响应前300字:', xml.substring(0, 300).replace(/\s+/g, ' '));
      }

      let matched = 0;
      for (const it of items) {
        if (seen.has(it.url) || existingUrls.has(it.url)) continue;
        if (it.title.length < 8) continue;
        if (!ARMOR_KEYWORDS.test(it.title)) continue;
        if (EXCLUDE_KEYWORDS.test(it.title)) continue;
        if (!isRecent(it.pubDate)) continue;

        seen.add(it.url);
        matched++;
        all.push({ title: it.title, url: it.url, source: src.name, pubDate: it.pubDate, category: categorize(it.title) });
      }
      console.error('  匹配:', matched);
    } catch (e) {
      console.error('  失败:', e.message);
    }
  }

  const stats = {};
  for (const r of all) stats[r.category] = (stats[r.category] || 0) + 1;
  console.error('[search] 新文章:', all.length, Object.entries(stats).map(([k,v]) => k + ':' + v).join(' '));

  process.stdout.write(JSON.stringify({ results: all }));
}

main().catch(e => {
  console.error('[search] FATAL:', e.message);
  process.stdout.write(JSON.stringify({ results: [] }));
});
