# 配置管理

OuonnkiTV 支持通过环境变量预定义应用的默认配置。当用户点击 **设置** → **关于项目** → **配置操作** → **恢复默认配置** 时，应用将重置为这些预定义的默认值。

---

## 环境变量参考

所有配置均使用 `OKI_` 前缀。Docker 镜像在容器启动时读取；Vercel、Cloudflare Pages、Netlify 在构建时读取；本地开发在 Vite 启动时读取。

| 变量名                      | 必需 | 说明                                                                        |
| --------------------------- | ---- | --------------------------------------------------------------------------- |
| `OKI_INITIAL_VIDEO_SOURCES` | 否   | 初始视频源（JSON 字符串或远程 URL）                                         |
| `OKI_TMDB_API_TOKEN`        | 否   | TMDB API Token，启用 [TMDB 智能模式](#-tmdb-配置建议启用)获取影片元数据     |
| `OKI_TMDB_API_BASE_URL`     | 否   | TMDB API 基础地址（默认 `https://api.themoviedb.org/3`）                    |
| `OKI_TMDB_IMAGE_BASE_URL`   | 否   | TMDB 图片基础地址（默认 `https://image.tmdb.org/t/p/`）                     |
| `OKI_ACCESS_PASSWORD`       | 否   | 访问密码（留空则公开访问）                                                  |
| `OKI_DISABLE_ANALYTICS`     | 否   | 设为 `true` 禁用 Vercel Analytics（Docker 等非 Vercel 部署建议设为 `true`） |
| `OKI_INITIAL_CONFIG`        | 否   | 完整 JSON 配置（包含设置、视频源、订阅等导出数据）                          |

### 默认视频源（`OKI_INITIAL_VIDEO_SOURCES`）

支持两种格式：

**JSON 字符串：**

```env
OKI_INITIAL_VIDEO_SOURCES=[{"name":"示例源","url":"https://api.example.com","isEnabled":true}]
```

**远程 URL：**

```env
OKI_INITIAL_VIDEO_SOURCES=https://example.com/sources.json
```

> JSON 字段详细说明和格式要求请参考 [视频源导入](./video-sources.md)

### 完整配置导入（`OKI_INITIAL_CONFIG`）

使用 `OKI_INITIAL_CONFIG` 可一次性导入完整配置（包含所有应用设置、视频源和订阅），格式与应用内「导出个人配置」生成的 JSON 一致。`videoSources` 也可直接填写返回视频源 JSON 数组的远程 URL。

```env
OKI_INITIAL_CONFIG='{"settings":{...},"videoSources":[...],"meta":{...}}'
```

远程视频源示例：

```env
OKI_INITIAL_CONFIG='{"settings":{...},"videoSources":"https://example.com/sources.json","subscriptions":[...]}'
```

`settings.system.tmdbApiToken`、`subscriptions`、`adFilteringEnabled` 均会在首次启动及「恢复默认配置」时恢复。Docker 中修改初始配置后需重建容器；其他托管平台需重新部署。初始视频源或完整配置变化时，浏览器会重新执行一次初始内容导入；若需用新版默认值完全替换浏览器中已有的本地配置，请执行「恢复默认配置」。

> **优先级说明**：`OKI_INITIAL_CONFIG` 中的视频源和设置优先于 `OKI_INITIAL_VIDEO_SOURCES` 及代码默认值。

### 操作指南

1. **导出模版**：在应用中配置好理想状态，点击 **导出个人配置** → **导出为文本**
2. **设置变量**：将复制的 JSON 内容赋值给 `OKI_INITIAL_CONFIG` 环境变量
3. **应用配置**：根据部署方式使变量生效
   - **Docker Compose**：`docker-compose up -d --force-recreate`
   - **Docker 预构建镜像**：删除旧容器，使用 `-e` 或 `--env-file` 重建容器
   - **Vercel**：在项目设置 → Environment Variables 中添加，保存后重新部署
   - **Cloudflare Pages**：在项目设置 → Environment Variables 中添加，触发重新构建
   - **Netlify**：在 Site settings → Environment variables 中添加，触发重新部署
   - **本地开发**：写入 `.env` 文件后重启 `pnpm dev`
4. **恢复默认**：执行「恢复默认配置」，应用将加载该 JSON 中的状态

---

## TMDB 配置（建议启用）

OuonnkiTV 支持通过 [TMDB](https://www.themoviedb.org/)（The Movie Database）获取影片元数据、海报和推荐内容。启用后可显著提升浏览体验，建议所有用户配置。

> Token 申请方法请参考 [TMDB API Key 申请指南](./tmdb-key.md)

### 两种运行模式

| 模式              | 说明                                                             |
| ----------------- | ---------------------------------------------------------------- |
| **TMDB 智能模式** | 启用 TMDB 集成，搜索结果自动匹配影片元数据、显示海报、评分和推荐 |
| **兼容模式**      | 关闭 TMDB，仅使用视频源自身数据，适合无 TMDB Token 的场景        |

### 配置方式

**方式一：环境变量（部署时配置）**

```env
OKI_TMDB_API_TOKEN=your_tmdb_api_token_here
OKI_TMDB_API_BASE_URL=https://api.themoviedb.org/3
OKI_TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p/
```

配置后应用默认启用 TMDB 智能模式。

说明：

- `OKI_TMDB_API_BASE_URL` 支持绝对地址或相对路径（如 `/tmdb-api`），会自动补齐 `/3`。
- `OKI_TMDB_IMAGE_BASE_URL` 支持绝对地址或相对路径（如 `/tmdb-image`），会自动补齐 `/t/p/`。
- 中国大陆网络环境如遇 TMDB 官方域名访问不稳定，建议配置 `OKI_TMDB_API_BASE_URL=https://api.tmdb.org` 与 `OKI_TMDB_IMAGE_BASE_URL=https://image.tmdb.org`。

**方式二：应用内手动输入**

如果未配置环境变量 Token，可以在运行时手动配置：

1. 进入 **设置** → **系统设置** → **系统行为**
2. 在「TMDB API Token」输入框中输入你的 Token
3. （可选）在「TMDB API Base URL / TMDB 图片 Base URL」中填写自定义地址
4. 开启「TMDB 智能模式」开关

> Token 从 [themoviedb.org](https://www.themoviedb.org/settings/api) 获取（需注册账户），详细申请步骤见 [TMDB API Key 申请指南](./tmdb-key.md)。
> Base URL 优先级：设置页填写值 > 环境变量 > 官方默认值。留空表示不覆盖，自动回退。

> 浏览器端应用必须读取这些值，因此 `OKI_TMDB_API_TOKEN`、`OKI_ACCESS_PASSWORD` 等变量会发送到浏览器，不能当作服务端机密。

### TMDB 智能模式设置

启用 TMDB 后可调整以下选项：

| 设置项        | 说明                           | 默认值            |
| ------------- | ------------------------------ | ----------------- |
| TMDB 内容语言 | 影片标题、简介等数据的显示语言 | 简体中文（zh-CN） |
| TMDB 图片质量 | 海报和背景图的加载质量         | 中（w500/w780）   |

可选语言：简体中文、繁體中文、English、日本語

图片质量等级：

- **低**：w342（节省流量）
- **中**：w500/w780（推荐）
- **高**：original（最佳画质，流量消耗大）
