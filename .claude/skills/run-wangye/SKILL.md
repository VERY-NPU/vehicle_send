---
name: run-wangye
description: 生成、部署装甲车辆每日资讯网页并推送微信通知。当用户提到"装甲车辆""坦克""火炮""军事资讯""装甲新闻""每日资讯"时使用。
---

# 🚀 WangYe — 装甲车辆每日资讯

这是一个军事资讯聚合网页应用。每次触发时搜索、整理国内外装甲车辆最新资讯，生成漂亮的 HTML 网页，并可部署到 GitHub Pages，通过 Server 酱推送到微信。

## 工作流程

```
用户触发 → 搜索资讯 → 整理分类 → 生成 HTML → 部署 GitHub Pages → 微信推送
```

## 快速开始

### 手动触发（Claude Skill 模式）

当用户说"今天的装甲车辆资讯"或类似关键词时：

1. **搜索资讯**: 使用 WebSearch 并行搜索多个话题
   - 国内: 坦克发展、新型火炮、装甲车辆、AI+军事
   - 国外: new tanks, artillery advances, armored vehicles, AI in military armor
2. **整理数据**: 按 `data.json` 格式整理为 JSON
3. **生成网页**: 将 JSON 通过 stdin 传给 `driver.mjs generate`
4. **部署**: 运行 `node .claude/skills/run-wangye/driver.mjs deploy`
5. **推送**: 运行 `node .claude/skills/run-wangye/driver.mjs push "标题" "网址" "摘要"`

### 搜索格式

搜索时使用以下策略：
- 中文搜索: "2026年 坦克 最新进展"、"人工智能 装甲车辆 2026"
- 英文搜索: "latest tank developments 2026"、"AI military vehicles 2026"
- 重点优先搜索 AI+装甲相关（Army AI, autonomous tank, smart artillery）

### 数据格式 (data.json)

```json
{
  "ai": [
    {
      "title": "人工智能在坦克火控系统取得新突破",
      "url": "https://example.com/news/1",
      "summary": "最新的AI火控系统可自动识别并追踪多个目标...",
      "category": "AI",
      "source": "国防科技",
      "image": "https://example.com/img.jpg"
    }
  ],
  "cn": [
    {
      "title": "国产新型主战坦克亮相",
      "url": "https://example.com/news/2",
      "summary": "...",
      "category": "坦克",
      "source": "兵器知识",
      "image": ""
    }
  ],
  "int": [
    {
      "title": "US Army tests new Abrams variant",
      "url": "https://example.com/news/3",
      "summary": "The latest variant of M1 Abrams...",
      "category": "tank",
      "source": "Defense News",
      "image": ""
    }
  ]
}
```

**分类关键词匹配**:
- `坦克` / `tank`: 主战坦克、轻型坦克、两栖坦克
- `火炮` / `artillery`: 自行火炮、榴弹炮、火箭炮、迫击炮
- `装甲车` / `afv`: 步兵战车、装甲输送车、两栖装甲车
- `AI` / `人工智能`: 无人机控制、自主系统、智能火控、无人炮塔
- AI 相关条目会在页面置顶展示

### 生成网页

```bash
cat data.json | node .claude/skills/run-wangye/driver.mjs generate
```

输出: `docs/index.html`

### 部署到 GitHub Pages

```bash
node .claude/skills/run-wangye/driver.mjs deploy
```

需要先设置 git remote:
```bash
git remote add origin https://github.com/YOUR_USER/wangye.git
```

### 推送微信通知 (Server 酱)

```bash
# 设置环境变量
export SERVER_CHAN_KEY=your_server_chan_key

# 发送推送
node .claude/skills/run-wangye/driver.mjs push "装甲车辆资讯更新" "https://xxx.github.io/wangye/" "今日共15条资讯"
```

### 本地预览

```bash
npm run serve
# 浏览器打开 http://localhost:3000
```

### 每日自动运行

```bash
node .claude/skills/run-wangye/driver.mjs daily
```

该命令依次: generate → deploy → push

## 自动化部署 (GitHub Actions)

配置 `.github/workflows/daily-news.yml` 后，每天北京时间 8:00 自动运行。
需要在 GitHub Secrets 中设置 `SERVER_CHAN_KEY`。

## 前置要求

- Node.js >= 18
- Git
- Server 酱账号 (sct.ftqq.com) 获取推送密钥
- GitHub 账号 (用于 GitHub Pages 和 Actions)

## 页面说明

- 🔥 **AI+装甲** 专题置顶显示
- 🇨🇳 **国内资讯**: 坦克 / 火炮 / 装甲车辆 / AI 应用
- 🌍 **国际资讯**: 坦克 / 火炮 / 装甲车辆 / AI 应用
- 响应式设计，手机可直接访问
- 支持按分类 Tab 筛选

## Gotchas

- GitHub Pages 首次部署需要几分钟生效
- Server 酱免费版每天最多 500 条推送，绰绰有余
- 如果搜索不到新内容，页面会显示"暂无相关资讯"
- 图片 URL 需使用绝对路径（https://...），本地图片不会被 GitHub Pages 引用

## Troubleshooting

| 症状 | 原因 | 解决 |
|------|------|------|
| `git push` 失败 | 未设置 remote | `git remote add origin <your-repo-url>` |
| 推送未收到 | SERVER_CHAN_KEY 未设置 | `export SERVER_CHAN_KEY=xxx` |
| 本地打开空白 | `docs/index.html` 未生成 | 先运行 `npm run generate` |
| 搜索无结果 | 关键词不匹配 | 调整搜索词，加上当前年份 |