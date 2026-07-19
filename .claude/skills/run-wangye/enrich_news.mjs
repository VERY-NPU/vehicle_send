/*!
 * enrich_news.mjs — 使用 DeepSeek API 为新闻文章生成摘要/分析/启示
 *
 * 输入: stdin JSON { results: [{title, url, source, category}] }
 * 输出: { enriched: [{title, url, source, category, summary, expert_analysis, china_insight}] }
 *
 * 环境变量: DEEPSEEK_API_KEY
 */

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const MAX_RETRIES = 2;

// ─── DeepSeek 调用 ───────────────────────────────
async function callDeepSeek(messages) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 环境变量未设置');

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('API 返回空内容');
      return content.trim();
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES) {
        console.error('[enrich] 重试', attempt + 1, '/', MAX_RETRIES);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw lastError;
}

// ─── 解析 AI 返回 ────────────────────────────────
function parseAIResponse(text) {
  const result = { summary: '', expert_analysis: '', china_insight: '' };

  const summaryMatch = text.match(/(?:摘要|【摘要】)[：:]*\s*([\s\S]*?)(?=(?:\n\n|\n(?:分析|【分析】|深度分析|【深度分析】|专家分析|【专家分析】)|$))/i);
  if (summaryMatch) {
    result.summary = summaryMatch[1].replace(/^[-*]\s*/gm, '').trim();
  }

  const analysisMatch = text.match(/(?:分析|【分析】|深度分析|【深度分析】|专家分析|【专家分析】|军迷深度分析)[：:]*\s*([\s\S]*?)(?=(?:\n\n|\n(?:启示|【启示】|对我国|【对我国】)|$))/i);
  if (analysisMatch) {
    result.expert_analysis = analysisMatch[1].replace(/^[-*]\s*/gm, '').trim();
  }

  const insightMatch = text.match(/(?:启示|【启示】|对我国|【对我国】|对我国启示|【对我国启示】)[：:]*\s*([\s\S]*?)$/i);
  if (insightMatch) {
    result.china_insight = insightMatch[1].replace(/^[-*]\s*/gm, '').trim();
  }

  // Fallback: if structured parsing failed, split by numbered sections
  if (!result.summary && !result.expert_analysis && !result.china_insight) {
    // Try: 1. 2. 3. format
    const parts = text.split(/\n\d+[\.\、\)]\s*/);
    if (parts.length >= 4) {
      result.summary = parts[1].trim();
      result.expert_analysis = parts[2].trim();
      result.china_insight = parts[3].trim();
    } else {
      // Last resort: use first 40%, middle 35%, last 25%
      const len = text.length;
      result.summary = text.substring(0, Math.floor(len * 0.4)).trim();
      result.expert_analysis = text.substring(Math.floor(len * 0.4), Math.floor(len * 0.75)).trim();
      result.china_insight = text.substring(Math.floor(len * 0.75)).trim();
    }
  }

  return result;
}

// ─── 单篇文章处理 ────────────────────────────────
async function enrichArticle(article, index, total) {
  console.error(`[enrich] [${index + 1}/${total}] ${article.title.substring(0, 50)}...`);

  const prompt = `你是一位资深军事博主的AI助手，专门撰写装甲车辆（坦克/装甲车/火炮/军事AI）领域的深度分析内容。请根据以下新闻标题，撰写三个独立板块：

【摘要】
写一段约200-300字的信息摘要，提炼该新闻的核心事实、技术参数和关键背景。用专业军事术语，信息密度高，不要空洞。

【军迷深度分析】
写一段约500-700字的深度分析，包括：技术点评（装备性能参数对比分析）、战术/战略层面推理（战场运用场景推演）、批判性独立见解（不盲从官方口径）。体现资深军迷的独立视角。

【对我国的启示】
写一段约350-500字的启示，包括：对我国现役同类装备发展的具体建议、编制体制调整建议、战术战法创新建议。必须具体可操作，避免讲空话套话。

新闻标题：${article.title}
${article.source ? '来源：' + article.source : ''}
${article.pubDate ? '发布日期：' + article.pubDate : ''}

请严格按照上面三个板块的格式回复，每个板块用标题分隔。`;

  try {
    const response = await callDeepSeek([
      { role: 'system', content: '你是一位资深军事博主，精通装甲车辆和军事技术分析，善于用专业视角对军事新闻进行深度解读。回复必须用中文。' },
      { role: 'user', content: prompt },
    ]);

    const parsed = parseAIResponse(response);
    // 验证内容非空
    if (!parsed.summary || parsed.summary.length < 30) {
      console.error('[enrich]   警告：摘要过短');
    }
    if (!parsed.expert_analysis || parsed.expert_analysis.length < 100) {
      console.error('[enrich]   警告：分析过短');
    }
    if (!parsed.china_insight || parsed.china_insight.length < 50) {
      console.error('[enrich]   警告：启示过短');
    }

    return {
      title: article.title,
      url: article.url,
      source: article.source,
      category: article.category,
      summary: parsed.summary,
      expert_analysis: parsed.expert_analysis,
      china_insight: parsed.china_insight,
    };
  } catch (e) {
    console.error('[enrich]   失败:', e.message);
    // 返回空内容，由调用方决定是否跳过
    return {
      title: article.title,
      url: article.url,
      source: article.source,
      category: article.category,
      summary: '',
      expert_analysis: '',
      china_insight: '',
      _error: e.message,
    };
  }
}

// ─── 批量处理 ────────────────────────────────────
async function enrichBatch(articles) {
  if (articles.length === 0) return [];

  // 限制每天最多处理 10 篇（控制 API 费用）
  const MAX_PER_RUN = 10;
  const batch = articles.slice(0, MAX_PER_RUN);
  if (articles.length > MAX_PER_RUN) {
    console.error(`[enrich] 文章过多(${articles.length})，只处理前${MAX_PER_RUN}篇`);
  }

  const enriched = [];
  for (let i = 0; i < batch.length; i++) {
    const result = await enrichArticle(batch[i], i, batch.length);
    // 只保留成功生成内容的
    if (result.summary && result.summary.length >= 30) {
      delete result._error;
      enriched.push(result);
    } else {
      console.error(`[enrich] 跳过空内容: ${result.title.substring(0, 40)}`);
    }
  }

  return enriched;
}

// ─── 主流程 ──────────────────────────────────────
async function main() {
  // 读取 stdin
  const chunks = [];
  process.stdin.setEncoding('utf-8');
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = chunks.join('');

  if (!raw.trim()) {
    console.error('[enrich] 输入为空，跳过');
    process.stdout.write(JSON.stringify({ enriched: [] }));
    return;
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    console.error('[enrich] JSON 解析失败:', e.message);
    process.stdout.write(JSON.stringify({ enriched: [] }));
    return;
  }

  const articles = input.results || [];
  if (articles.length === 0) {
    console.error('[enrich] 没有待处理的文章');
    process.stdout.write(JSON.stringify({ enriched: [] }));
    return;
  }

  console.error(`[enrich] 待处理 ${articles.length} 篇文章`);
  const enriched = await enrichBatch(articles);
  console.error(`[enrich] 成功生成 ${enriched.length} 篇`);

  process.stdout.write(JSON.stringify({ enriched }));
}

main().catch(e => {
  console.error('[enrich] FATAL:', e.message);
  process.stdout.write(JSON.stringify({ enriched: [] }));
});
