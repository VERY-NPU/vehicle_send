# 🚀 装甲车辆每日资讯 (WangYe)

> 自动搜集、整理国内外装甲车辆最新资讯，生成精美网页，推送微信通知。

**在线访问**: [https://yourname.github.io/wangye/](https://yourname.github.io/wangye/) *(部署后生效)*

## 功能

- 🔥 AI+装甲 前沿动态置顶
- 🇨🇳 国内资讯: 坦克 / 火炮 / 装甲车辆 / AI应用
- 🌍 国际资讯: 坦克 / 火炮 / 装甲车辆 / AI应用
- 📱 响应式设计，手机友好
- 📲 微信推送通知 (Server 酱)
- ⏰ 每天自动更新 (GitHub Actions)

## 快速开始

```bash
# 安装依赖
npm install

# 生成网页
cat data.json | node .claude/skills/run-wangye/driver.mjs generate

# 本地预览
npm run serve
# 打开 http://localhost:3000
```

## 部署到 GitHub Pages

1. 在 GitHub 创建仓库
2. 设置远程仓库: `git remote add origin https://github.com/YOUR_USER/wangye.git`
3. 运行部署: `node .claude/skills/run-wangye/driver.mjs deploy`
4. 在仓库 Settings → Pages 中选择 `gh-pages` 分支

## 微信推送

1. 访问 [Server 酱](https://sct.ftqq.com) 注册并微信扫码绑定
2. 获取 SendKey
3. 设置环境变量: `export SERVER_CHAN_KEY=your_key`
4. 推送测试: `node .claude/skills/run-wangye/driver.mjs push "测试" "https://example.com"`

## 自动更新

配置 GitHub Actions (`.github/workflows/daily-news.yml`) 后，每天北京时间 8:00 自动:
1. 读取数据 → 2. 生成网页 → 3. 部署到 GitHub Pages → 4. 推送微信通知

在 GitHub Secrets 中设置 `SERVER_CHAN_KEY` 即可启用微信推送。

## 项目结构

```
├── .claude/skills/run-wangye/   # Claude Code Skill
│   ├── SKILL.md                  # Skill 指令
│   ├── driver.mjs                # 驱动脚本
│   └── template.html             # 网页模板
├── docs/                         # 生成的网页
├── .github/workflows/            # 自动更新
├── data.json                     # 资讯数据
└── package.json
```

## License

仅供学习参考。资讯来源于网络公开信息。