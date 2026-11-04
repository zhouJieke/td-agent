# 桌面端（Tauri）钉钉二维码登录 · 前后端对接说明

只走一条链路：**桌面端永远不接触钉钉，只接触本服务**。钉钉的 AppSecret、授权码交换、
身份匹配、在职判定全在后端；桌面端拿到的就是本服务签发的标准 JWT + refresh token。

## 两种二维码渲染方式，二选一（后端逻辑完全相同）

| 方式 | 谁画二维码 | 前端要做 | 必须登记的钉钉回调 |
|---|---|---|---|
| **A. 后端内嵌页**（默认） | 后端 `loginPage` 里的钉钉 iframe SDK | Tauri 开子窗口加载远程页，capability 放行该远程域 | `/login/oauth2/code/dingtalk` |
| **B. 前端自渲染** | 前端拿 `authUrl` 用 qrcode 库画成图片，**手机钉钉扫它** | 不需要 webview、不需要远程域白名单、不需要 iframe | `/desktop/cb` |

方式 B 的约束只有两条：`authUrl` **必须原样使用后端返回的值**（别自己拼，`state` 就是一次性 nonce，
自己拼会丢掉防冒名保护）；以及钉钉后台要多登记一条回调：

```
http://bcw-test.jinmit.com/desktop/cb
```

扫码后手机会打开一个结果页（登录成功/已取消/已失效），桌面端继续用 `claim` 取 token，
其余接口与错误码语义和方式 A 一模一样。

## 时序

```
桌面端(Rust)                       本服务                          钉钉
   │ POST /desktop/api/begin ───────▶  发 nonce + claimKey
   │ ◀──────────────────  {nonce, claimKey, loginPage, authUrl}
   │ 方式A：打开 webview ────────────▶ GET /desktop/login.html?nonce=…
   │                                  页面用 DTFrameLogin 渲染二维码 ──▶ 用户扫码/手机确认
   │                                  页面 POST /desktop/api/exchange {nonce, authCode}
   │ 方式B：本地把 authUrl 画成二维码 ───────────────────────────────▶ 手机钉钉扫码，在钉钉内授权
   │                                  钉钉 GET /desktop/cb?code&state(=nonce) → 同样换 token 写票据
   │                                     后端：authCode→unionId→匹配工号→判在职→签 token→写票据
   │ POST /desktop/api/claim ───────▶  一次性领取 token（带 claimKey）
   │ 之后过期时 POST /desktop/api/refresh {refreshToken}
```

`nonce` 会出现在二维码页的 URL 里，`claimKey` **只回给桌面端**。二维码页换到了 token 也领不走 —— 这是
防「拿到 nonce + authCode 就能冒领别人 token」的关键，别把它合并成一个值。

## 接口

| 方法 | 路径 | 入参 | 出参 |
|---|---|---|---|
| POST | `/desktop/api/begin` | 无 | `{nonce, claimKey, loginPage, authUrl}` |
| GET | `/desktop/cb` | 钉钉回跳 `?code&state`（手机浏览器打开，前端不用调） | HTML 结果页 |
| GET | `/desktop/api/meta` | 无 | `{clientId, scope}`（二维码页用，不含任何密钥） |
| POST | `/desktop/api/exchange` | `{nonce, authCode}` | 200 `{status:"ok"}` / 400 `{error,error_description}` |
| POST | `/desktop/api/claim` | `{nonce, claimKey}` | 200 token JSON / 202 未扫码 / 410 过期或 key 不对 |
| POST | `/desktop/api/refresh` | `{refreshToken}` | 200 token JSON / 400 `invalid_grant` |

token JSON（claim 与 refresh 同形）：

```json
{
  "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 7200,
  "refresh_token": "<不透明串>", "refresh_expires_in": 2592000, "scope": "mcp",
  "employee_number": "TD000001", "employee_name": "张三"
}
```

## 桌面端要实现的事

1. **Rust 侧发请求**（`tauri-plugin-http` 或直接 reqwest），不要用 webview 的 `fetch` 打后端 —— 那是跨域，
   会被 CORS 挡，也免得为此开 CORS 白名单。
2. **claimKey 与 token 存系统钥匙串**（`tauri-plugin-stronghold` 或 keychain），不要 localStorage / 明文文件。
3. **轮询节奏**：`claim` 每 1.5–2s 一次即可；收到 202 继续，410 就提示"登录已过期，请重试"并重新 begin。
   二维码从生成到失效是 5 分钟（`nonce` 的 TTL），授权成功后有 2 分钟领取窗口。
4. **启动时静默续期**：access token 过期前（或任意一次 401）调 `refresh`。**refresh token 一次一换**，
   每次都要保存返回的新值；用第二次必定 400。这样 30 天内用户只需扫一次码。
5. webview 窗口要允许加载 `http://bcw-test.jinmit.com` 这个远程地址（Tauri capability 里配），
   并在页面上保留「重新获取二维码」的 reload 能力。

## 错误处理对照（后端真实行为，已逐条实测）

| 场景 | 状态 | 桌面端该做 |
|---|---|---|
| 未扫码就来 claim | 202 | 继续轮询 |
| nonce 过期 / claimKey 不对 | 410 | 重新 begin，不要继续轮询 |
| authCode 无效或用过 | 400 `invalid_grant` | 提示重新扫码 |
| unionId 在库里没有对应员工 | 400 `...IM 身份尚未绑定员工...`（见 error_description） | 提示"该钉钉账号未绑定员工，联系管理员" |
| 离职生效（含离职当天） | 400 刷新时 / 403 调接口时 | 清本地 token，强制重新登录 |
| access token 被撤销 | 403 `该工号的令牌已被撤销，请重新登录` | 同上 |
| access token 过期 | 401 | 先 refresh，成功就重试一次 |

## 服务端配置

```yaml
td:
  auth:
    issuer: http://bcw-test.jinmit.com      # 决定 token 的 iss，必须与实际访问地址一致
    desktop-client-id: td-desktop           # 桌面端 token 的 aud，可省（默认就是它）
```

钉钉后台的「重定向URL（回调域名）」必须包含 `<同源的域名>/login/oauth2/code/dingtalk`：
钉钉内嵌二维码要求**页面与 redirect_uri 同源**（协议+域名+端口一致），所以二维码页由本服务提供，
不能打进 Tauri 安装包。

## 已知限制与实现取舍

- **刷新不走 `/oauth2/token`**：实测 Spring 授权服务器的 public client（`ClientAuthenticationMethod.NONE`）
  只在 PKCE 授权码交换时免密，`grant_type=refresh_token` 仍要求客户端认证 → 桌面端拿不到 secret 就是 401。
  所以刷新收进 `/desktop/api/refresh`，顺带把「refresh token 一次性」和「离职即刷不出来」做实。
- **`revokeEmployeeAuthJob`（xxl-job）撤销后**：Redis 里该工号的授权全删（refresh 立即失效），
  并写撤销时间戳让已签出的 access token 也立刻 403（比对 JWT 的 `iat`）。会话态（浏览器扫码那条）不受影响。
- **二维码登录不参与 `oauth2Login` 那条浏览器链**，两条链并存、互不影响；浏览器链仍走
  `/oauth2/authorization/dingtalk` → `/login/oauth2/code/dingtalk`。
- **方式 B 为什么可行而「前端自己用 iframe SDK」不行**：钉钉的同源要求只约束 iframe 内嵌模式
  （页面 origin 必须等于 `redirect_uri` origin）。手机扫 `authUrl` 时授权页跑在手机钉钉内置浏览器里，
  与桌面端 origin 无关，所以前端可以完全自己控制二维码的呈现。
- `authUrl` 的回调地址由 `td.auth.issuer` 推导（`<issuer>/desktop/cb`），换域名不用改代码，
  但钉钉后台那条登记要跟着改。issuer 没配时接口会直接报「需要 td.auth.issuer 指向对外可访问地址」。
