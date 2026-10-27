# 模型后台接口约定

桌面端不向用户暴露任何模型配置：域名在本机设置里填一次，模型清单全部来自后台。
角色分工——授权接口（谁有什么模型）由后台团队实现；AI 网关负责转发模型请求；桌面端只做「拉取 → 落盘 → 写进核心配置」。

## 1. 域名入口

- 桌面端 设置 → 「应用」标签 → 「模型后台域名」，值为 http/https origin，可带路径前缀（例：`https://gw.example.com`）。
- 保存后写入桌面端配置 `model_backend_url`，随核心子进程环境 `DSH_MODEL_BACKEND_URL` 下发，**下次启动服务生效**。
- 留空时不注入该变量，因此开发态可直接用同名环境变量接管：`DSH_MODEL_BACKEND_URL=https://gw.example.com pnpm dev:desktop`。
- 未配置域名时桌面端完全不访问后台，模型设置界面按原有形态存在与否由发版决定（见第 7 节）。

## 2. 授权接口

`GET {域名}/api/model-provider/config`

请求头：

- `accept: application/json`
- `authorization: Bearer <access token>` —— token 从核心凭据引用 `DSH_ACCESS_TOKEN` 解析（登录模块把 token 写进这个引用；未写入时凭据服务会退到同名环境变量）。解析不到就匿名请求。

后台按这个 token 判定用户身份，返回**这个人**能用的模型。换 token 就换清单，这是「按人控制」的唯一依据。

响应体是**网关数组**，一个元素一个上游。也兼容两种既有形态：裸对象（等价于单元素数组），以及 `{"code":0,"msg":null,"data":[网关数组]}` 这一类 Java/Go 信封——信封里的 `data` 只有在元素本身是网关对象时才当清单用，否则退回 OpenAI 风格的 models 列表：

```json
[
  {
    "route": "company-gw",
    "baseURL": "https://gw.example.com/api/v1",
    "api": "openai-completions",
    "name": "公司网关",
    "apiKey": "sk-issued-per-user",
    "headers": { "x-tenant": "tc" },
    "models": [
      {
        "id": "deepseek-chat",
        "name": "DeepSeek Chat",
        "contextWindow": 128000,
        "maxTokens": 8192,
        "input": ["text", "image"],
        "reasoningEfforts": { "off": null, "low": "low", "medium": "medium", "high": "high" },
        "compat": { "thinkingFormat": "chat-template", "supportsDeveloperRole": false }
      }
    ]
  },
  {
    "route": "vendor-b",
    "baseURL": "https://api.vendor-b.com/v1",
    "api": "anthropic-messages",
    "apiKey": "sk-b",
    "models": [{ "id": "claude-x", "default": true }]
  }
]
```

字段规则：

- `route`：稳定标识，直接决定 `providers.<route>` 的键名与凭据引用名，用小写短横线（`company-gw`）。不要拿显示名当标识。缺省时按显式 `name` 的 slug 推导，推不出就用 `dsh-backend` / `dsh-backend-2` 按数组位置兜底；同一批里重复 `route` 只认第一条。
- 数组就是**全量权威**：这次没出现的 `route`，客户端会把它从配置里摘掉。所以「下线一个上游」= 把它从数组里去掉，不需要额外接口。
- 元素内除 `models[].id` 外全部可选。`baseURL` 缺省派生成 `{域名}/api/v1`（授权接口与网关同域时无需返回）；`api` 只认 `openai-completions` / `openai-responses` / `anthropic-messages`，缺省或无法识别回落 `openai-completions`。
- `apiKey` 缺省则不写凭据；给了就按 `route` 存进独立引用（`company-gw` → `COMPANY_GW_API_KEY`），配置里只留引用名。凭据按请求现解析，**换 key 不需要重启**，多个上游各自一把 key 互不覆盖。
- `headers` 里的 `authorization` 与 `x-api-key` 一律丢弃，不允许后台反向改写鉴权通道；其它头原样附到每次模型请求。
- `models[].name/contextWindow/maxTokens/input/reasoningEfforts/compat` 是能力事实；缺省项用桌面端已缓存的第三方模型目录表补齐（键按小写全名、末段、逐级 `-` 前缀匹配）。**注意**：内部别名（如 `qwen3.8-flash`）可能被目录表按前缀猜中一个并不准确的上下文长度，显式给出这两个字段比让客户端猜稳。
- 默认模型：元素内顶层 `defaultModel`（或 `default`）优先，其次首个 `default: true` 的模型；都没声明时该元素取第一条。多个元素同时声明默认时按数组顺序取第一个。

## 3. 下发与刷新

- 暂存区：`$DSH_HOME/dsh-tauri-model/gateway-models.json`（开发态在 `~/.dsh.dev` 下）。
- 启动顺序：先读暂存区下发（断网也有模型可用），随后立刻请求一次，之后每 15 分钟一次；同一轮次串行，不并发。
- 落点：核心设置命名空间 `llm-pi-ai` 的 `providers.<route>`，形态与用户手填的自定义 provider 完全一致；逐个比对指纹，内容没变化的上游不重复写，消失的上游 `unset`。
- 默认模型：写 `agent-default-model` 的 `provider=dsh-backend` 与 `model=<钦定 id>`，**仅当当前默认不在授权清单内**时才改写——用户在会话里自己切过的模型不会被下一轮刷回来。

## 4. 失败与撤销语义

- 权威撤销（后台明确回答「没有你的模型」）：空数组、裸对象里 `models: []`、HTTP 401 或 403 → 摘掉全部 `providers.<route>`，默认模型若指向它们则一并回退到发版默认，并删除暂存区。退出登录的客户端不会继续留着一套可用模型。
- 非权威失败（网络错误、超时、5xx、载荷畸形、所有元素都解析不出合法 id）：保留上一次下发，只记录错误，绝不清空。
- 部分元素畸形只丢那个元素，不牵连整批。因此「撤销个别模型」= 从 `models` 里去掉那一项；「下线某个上游」= 从数组里去掉那个元素；「停掉某人」= 返回空数组或 401/403。

## 5. AI 网关侧要求

- 协议三选一：OpenAI Chat Completions / OpenAI Responses / Anthropic Messages，路径按 `baseURL` 拼接。
- 必须**自己按凭据校验授权**。桌面端隐藏配置界面不等于权限控制，任何限制只在网关侧真正生效；建议网关对未授权模型返回 403，并把用量与 token 关联以便审计。
- 强烈建议支持**模型别名**（如 `code-latest`）：`models[].id` 固定不变，网关内部把别名映射到真实模型。这样换底层模型时客户端零变更、零等待。

## 6. 接入登录时要做的一件事

登录模块把用户的 access token 写入核心凭据引用 `DSH_ACCESS_TOKEN` 即可，其余不动。若你们最终用的是别的引用名，只需要改 `packages/dsh-tauri-model/src/host/service/gateway.ts` 里的 `TOKEN_REF` 常量。接口路径与请求头同理集中在 `gateway.utils.ts` 的 `MODELS_PATH`。

## 7. 模型配置界面的屏蔽位置

官方模型设置页由 `dsh-tauri-model` 的 `cordis.patch.yml` 关闭（`ui-settings-models: disabled`），本插件自身在客户端**不再注册** `settings.section` 的 `models` 座位与官方 API-key 引导；槽位不存在，因此设置导航与 `dsh://settings:open` 深链都到不了编辑器。会话头部的模型选择器不受影响——它读核心的模型目录，目录来自下放的清单。
