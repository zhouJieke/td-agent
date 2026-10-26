# 桌面端钉钉扫码登录（方式 B）

默认请求域名为 `http://bcw-test.jinmit.com`。所有登录网络请求均由 Rust 发起，不经过浏览器 fetch、Vite 代理或 Cookie 会话。

登录页保留“钉钉 / 企业微信”切换，由前端控制显示，不向后端添加平台参数。默认展示钉钉；企业微信仅显示“暂未开放”，等待后续接入接口。切换不重建或取消现有钉钉票据，已开始的钉钉领取、过期重取和登录成功处理继续按原流程运行。

项目根目录 `.cargo/config.toml` 已配置 rsproxy 的 Cargo 稀疏镜像，`pnpm tauri dev` 启动的 Cargo 会自动使用该配置，无需额外传入临时 `--config` 参数；配置仅作用于本项目。

更换域名时，通过进程环境变量传入后启动桌面端：

```sh
DSH_AUTH_API_BASE_URL=http://bcw-test.jinmit.com pnpm tauri dev
```

仅修改 `.env` 不会修改已经启动的 Rust 进程；打包后的应用也使用该进程环境变量，未设置时使用上述默认域名。

开发环境在运行 `pnpm tauri dev` 的终端输出 `desktop_auth` 日志：请求地址、HTTP 状态，以及 `begin response (redacted):` 后的实际 JSON 结构。点击“重新获取二维码”可再次触发。`nonce`、`claimKey`、令牌和 URL 查询参数等凭据会隐藏，发布版不输出此日志；请求由 Rust 发起，浏览器 Network 面板看不到。若 JSON 中缺少顶层 `authUrl`，需由后端补齐方式 B 的返回字段。

1. Rust `POST /desktop/api/begin`，请求 JSON `{}`，接收 `{nonce, claimKey, loginPage, authUrl}`。前端只获得本地 `loginId` 和 `authUrl`，通过 `qrcode` 生成 SVG 图片，保留四模块留白。
2. 用户使用手机钉钉扫描二维码，在手机内完成授权。钉钉访问服务端 `/desktop/cb?code&state`；桌面端不调用 callback、meta、exchange，不打开远程页面。
3. 桌面端每两秒通过 Rust `POST /desktop/api/claim`，JSON `{nonce, claimKey}`。202 继续等待；200 保存令牌并从同一返回值读取工号和姓名，进入工作台；410 提示“登录已过期，请重试”并自动重新 begin，同时保留“重新获取二维码”按钮供用户手动刷新。网络失败停止领取，用户手动重试。二维码 5 分钟有效期和授权成功后 2 分钟领取窗口由服务端判定；客户端以 410 为准，不用本地硬截止时间提前丢弃有效票据。
4. 重新生成或退出登录页时取消旧票据。进行中的旧请求晚返回也不能恢复旧二维码或旧登录状态；同一票据不并发领取。
5. 应用启动时从系统凭据库恢复登录态；access token 过期或将在 30 秒内过期时，Rust 调用 `POST /desktop/api/refresh`，JSON `{refreshToken}`。工作台运行期间每 15 秒检查到期时间，提前静默续期；任何鉴权业务请求也会先检查有效期。
6. 业务接口使用 `auth.request()`，由 Rust 添加 Bearer token。收到 401 时强制刷新并最多重试一次；并发 401 根据被拒 token 合并刷新。重试仍为 401 或刷新返回 `invalid_grant` 时删除持久凭据并回到登录页；不会无限重试。仅允许请求配置域名的 `/api/` 路径，禁止外部地址和跨域重定向。
7. 每次刷新先保存新 refresh token 再向调用者返回成功。系统凭据库写入失败时明确报错，当前进程保留新令牌并重试保存，不再次提交旧 refresh token。网络或服务错误保留凭据供重试；若服务端已经轮换但响应丢失，恢复能力取决于后端，不能承诺这种情况下仍免扫码。

`claimKey` 和 access/refresh token 通过 `keyring` 存储在系统凭据库：macOS Keychain、Windows Credential Manager、Linux Secret Service。系统凭据库不可用时不降级到明文文件或 Web Storage。开发版、发布版和不同登录域名使用不同的凭据命名空间；临时 claimKey 在取消、过期或领取成功后删除。

应用重启可恢复会话，30 天登录保持取决于后端 refresh token 的有效期、轮换及撤销策略。前端状态只保留工号、姓名、到期时间和二维码信息。没有新增远程页面权限，因为方式 B 不加载远程登录页面。

业务接口调用示例（路径需换成实际支持 Bearer 的接口）：

```ts
import { auth } from '@/store/modules/auth'

const result = await auth.request<MyResponse>('/api/your-endpoint')
```

当前仓库没有接入使用此登录 token 的业务接口；现有 SSH 远程管理请求继续访问本机服务，不附加企业 token。尚未登录时仍可直接进入本地工作台。

Rust 服务位于 `src-tauri/src/service/auth.rs`，命令位于 `src-tauri/src/bridge/auth.rs`，前端入口为 `src/store/modules/auth` 与 `src/ui/login`。认证命令使用 Tauri 原有本地命令权限，不向远程内嵌页面开放。

旧 `/api/auth/im/platforms`、`/api/auth/im/me`、`/oauth2/token`、`redirect_uri`、客户端密钥与 Cookie 桥接均已移除。后端独立维护钉钉平台的回调域名。

联调记录：2026-10-26，测试环境 begin 返回 200，但仅有 `nonce`、`claimKey`、`loginPage`，缺少方式 B 必需的 `authUrl`；claim 正常返回 202。后端需补齐真实钉钉授权 `authUrl`。客户端在缺失时明确报错，不会把 `loginPage` 编成二维码。
