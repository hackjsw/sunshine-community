# ✨ Sunshine Community (阳光社区)

一个基于 Cloudflare Workers + D1 数据库构建的轻量级、无服务器 (Serverless) 记忆碎片/微博客社区。

它拥有精致的毛玻璃 UI 设计，支持 Markdown 富文本编辑，拥有完整的时间轴回顾功能，旨在记录当下的时光。

## 🌟 特性 (Features)

* **轻量极速**：基于 Hono 框架开发，运行在 Cloudflare 边缘网络，秒级响应。
* **沉浸式 UI**：
    * 现代化的 Glassmorphism (毛玻璃) 风格。
    * 精准对齐的时间轴设计。
    * 全局鼠标跟随光效与动态背景。
    * 自适应布局（支持移动端）。
* **全功能编辑器**：
    * 支持 Markdown 语法（加粗、代码块、链接等）。
    * 内置海量 Emoji 选择器。
    * 支持 `Ctrl + Enter` 快捷键发送。
* **用户系统**：
    * JWT 安全鉴权。
    * 支持自定义昵称 (Nickname)。
    * 私密/公开记忆切换。
    * 单条记忆分享功能。
* **管理后台**：
    * 管理员 (Admin) 专属控制台。
    * 一键开启/关闭全站注册。
    * 用户管理（查看列表、删除用户）。

## 🛠️ 技术栈 (Tech Stack)

* **Runtime**: Cloudflare Workers
* **Framework**: [Hono](https://hono.dev/)
* **Database**: Cloudflare D1 (SQLite)
* **Frontend**: Native HTML5 + CSS3 + Vanilla JS (无框架，零依赖)
* **Markdown**: Marked.js

## 🚀 本地开发 (Local Development)

### 1. 环境准备
确保你安装了 Node.js 和 Wrangler CLI：
```bash
npm install -g wrangler

```

### 2. 安装依赖

```bash
npm install

```

### 3. 初始化本地数据库

```bash
# 创建表结构
npx wrangler d1 execute brain-dump --local --file=./schema.sql

```

### 4. 启动开发服务器

```bash
npm run dev

```

访问 `http://127.0.0.1:8787` 即可看到效果。

---

## ☁️ 部署上线 (Deployment)

### 1. 登录 Cloudflare

```bash
npx wrangler login

```

### 2. 创建远程数据库

```bash
npx wrangler d1 create brain-dump

```

*注意：执行后，请将控制台返回的 `database_id` 复制并替换到 `wrangler.toml` 文件中。*

### 3. 同步数据库结构

```bash
npx wrangler d1 execute brain-dump --remote --file=./schema.sql

```

### 4. 部署代码

```bash
npx wrangler deploy

```

---

## ⚙️ 配置文件 (wrangler.toml)

确保你的 `wrangler.toml` 配置正确指向了你的 D1 数据库：

```toml
name = "brain-dump"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "brain-dump"
database_id = "你的-远程-数据库-ID"

```

## 📝 初始账号

* 项目部署后，**第一个注册的用户**将自动获得 **Admin** (管理员) 权限。
* 管理员可以在控制台开启或关闭注册功能。

## 📄 License

MIT License.
