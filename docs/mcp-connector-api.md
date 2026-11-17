# 企业 MCP 连接器后台接口约定

桌面端「插件扩展 → MCP」页分两个标签：**企业 MCP**（后台目录）与**已安装的 MCP**（本地事实）。
角色分工——后台只负责三件事：给出企业 MCP 目录（含搜索），在用户点「连接」时给出这条 MCP 的真实传输配置，以及给出已安装条目的展示元数据（名称 + 图标，接口 C，供「已安装」页冷启动时还原显示）。
**安装、启用/停用、删除、自定义添加、刷新落地全在桌面本地**（host 路由已存在），后台不需要管，也不需要存安装态。

token 复用登录模块：桌面经 `desktop_auth_request` 自动注入 `authorization: Bearer <access token>` 并处理续期，后台只按这个 token 判身份，换 token 换可见目录。

## 1. 通用约定

- **域名**：与 `/api/employee-skills/**` 同一个企业网关 origin（登录后拿到的 `api_base`）。路径必须以 `/api/` 开头、与网关同源，否则桌面侧直接拒绝发送。
- **鉴权**：请求头 `authorization: Bearer <access token>`、`accept: application/json`。token 无效/过期请返回 **HTTP 401**——桌面会自动续期并重试一次，二次 401 才清会话提示重新登录。
- **业务信封**：成功与业务错误都返回 **HTTP 200** + `{ "code": 0, "msg": null, "data": ... }`。`code === 0` 才读 `data`；否则把 `msg` 原样抛给界面展示。**参数错误、id 不存在/已下架一律 200 + `code=1` + 具体 `msg`，不要返回 400/404**（与 employee-skills 一致）。
- **分页字段**：对齐 employee-skills 的 `{ totalCount, pageNumber, pagesAvailable, items }`。

## 2. 接口 A：企业 MCP 目录（列表 + 搜索）

`GET /api/employee-mcps?pageNo=1&pageSize=20&keyword=`

入参（query，全部可选）：

- `pageNo`：页码，从 1 开始，缺省 1。
- `pageSize`：每页条数，缺省 20。
- `keyword`：搜索词，匹配 `name` / `description`；空或不传 = 全量。搜索在后台做（需求明确「搜索查询后台」）。

出参：

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "totalCount": 42,
    "pageNumber": 1,
    "pagesAvailable": 3,
    "items": [
      {
        "id": "mcp-gitlab",
        "name": "GitLab 代码助手",
        "iconUrl": "https://cdn.example.com/mcp/gitlab.png",
        "description": "查询仓库、MR 与流水线",
        "version": "1.2.0",
        "transport": "streamable-http",
        "authType": "credential"
      }
    ]
  }
}
```

字段规则：

- `id`：**必填，稳定主键**。本地安装映射、版本比对、更新回查全用它，别拿显示名当标识；同一目录里唯一且永不复用。
- `name`：**必填**，卡片显示名（中文）。
- `iconUrl`：可选，https 图标。缺省或加载失败时客户端用名称首字母兜底，所以不必保证一定有图。
- `description`：可选，一句话说明，卡片副标题。
- `version`：可选，版本串。客户端拿它和本地已安装版本比对，决定是否亮「更新」按钮；不给则不提示更新。
- `transport`：可选，`streamable-http` | `stdio`，仅用于列表标签展示；缺省按 `streamable-http`。真实传输以接口 B 为准。
- `authType`：可选，`oauth` | `credential` | `none`，仅用于卡片鉴权徽章；缺省 `none`。
- **可见性**：后台按 token 身份过滤，返回的 items 都应是这个人可连接的；不需要额外入参。是否按部门/工号细分由后台决定。
- **不要返回 `installed` / `connected` 字段**：安装态是本地事实，客户端按 `id` 自己映射，后台给了也会被忽略。

## 3. 接口 B：连接详情（点「连接」时取真实配置）

`GET /api/employee-mcps/{id}`

入参：路径参数 `id`（接口 A 的稳定主键）。

出参（`streamable-http` 主形态）：

```json
{
  "code": 0,
  "msg": null,
  "data": {
    "id": "mcp-gitlab",
    "name": "GitLab 代码助手",
    "version": "1.2.0",
    "transport": "streamable-http",
    "url": "https://mcp.example.com/gitlab",
    "headers": {
      "authorization": "Bearer <按人签发的短期 token>"
    }
  }
}
```

字段规则（`data` 与本地 `McpRow` 一一对应，本地 schema 为 `{ id, serverName, transport, disabled, command, args, env, cwd, url, headers }`，其中 `serverName` / `disabled` 由客户端本地生成，后台不返回）：

- `transport`：**必填**，`streamable-http` | `stdio`。
- `url`：`streamable-http` 时**必填**，真实 MCP endpoint（http/https）。
- `headers`：可选，鉴权/租户头。**建议后台在这里签发按人、短期的 token 注入**——客户端会把 headers 明文写进本地配置补丁，短期 + 按人能把泄露面压到最小。静态企业 key 也能用，但安全性差。
- `command` / `args` / `env` / `cwd`：仅 `transport=stdio` 时用。**v1 建议只上 `streamable-http`**：企业 stdio 要求用户本机已存在对应二进制，分发与版本都难保证；stdio 留作二期。
- `id` 不存在 / 已下架：返回 200 + `code=1` + `msg`（如「MCP 不存在或已下架」）。
- **更新不需要单独接口**：客户端点「更新」= 再调一次本接口，用新 `data` 覆盖本地配置。

## 4. 接口 C：展示元数据（已安装连接器还原名称与图标）

`GET /api/employee-mcps/meta`

入参：无。可见性按 token 身份过滤，与接口 A 同一口径。

响应：

```json
{
  "code": 0,
  "msg": null,
  "data": [
    { "id": "mcp-gitlab", "name": "GitLab", "iconUrl": "https://cdn.example.com/mcp-gitlab.png" },
    { "id": "mcd-mcp", "name": "万店掌 AI 功能 MCP 服务" }
  ]
}
```

- **不分页**：返回当前登录人可见的全量条目即可，数量级是几十个而不是几万条；顺序不做要求（客户端只按 `id` 查表）。
- **数组即全量权威**：后台下架的条目不出现在返回里，客户端据此回落显示本地存的 `serverName`（即 mcpCode），不需要额外的撤销接口。
- 只含展示字段。连接配置、`url`、`headers`、凭据一律不在本接口返回，仍走接口 B。
- `iconUrl` 可选，https；无图标时**省略该字段**（不要给空串），客户端按名称首字母兜底。
- 路径优先级：字面量 `/meta` 必须优先于 `/{mcpCode}` 模板匹配（Spring PathPattern 默认如此）。**目录里不要把 `mcp_code` 命名成 `meta`**，否则那条的接口 B 取不到。
- 客户端调用时机：桌面「已安装」列表里存在 `employee-mcp-<code>` 条目时才调一次；全是本地连接器时不发这个请求。

## 5. 明确不需要后台做的（避免过度开发）

- 自定义 MCP 添加：纯本地表单 / 粘贴 JSON，不经过后台。
- 卸载 / 删除：纯本地。
- 启用 / 停用：纯本地（写 cordis 插件入口 `disabled`，停用即不可用）。
- 安装态 / 连接态存储：本地，后台不存。
- 刷新按钮：重新调接口 A；更新：比对 `version` 后重调接口 B。
- OAuth 回调接口：若企业 MCP 走接口 B 的 `headers` 注入凭据，则**不需要** OAuth 授权/回调接口；只有真走标准 OAuth 的 MCP 才需要，v1 建议用 headers 注入避开。

## 6. 待后台确认

1. 真实网关 origin 与路径前缀：是否沿用 `/api/employee-mcps`（与 employee-skills 同网关）。
2. 目录可见性：全员可见，还是按部门/工号过滤。
3. 接口 B 的 `headers` 凭据：静态企业 key，还是按人短期 token（推荐后者）。
4. v1 传输范围：是否只支持 `streamable-http`（推荐），stdio 二期。