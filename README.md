# WechatOnCloud

在飞牛 NAS（x86_64 / arm64）上运行服务端微信：可管理**多个**微信实例，每个实例是一个独立的微信会话；多个 web 用户通过浏览器访问被授权的实例，实现跨设备消息同步、多端共享。

> 设计与选型详见 [技术方案.md](技术方案.md)。
> 部署形态：拉取 GHCR 预构建多架构镜像（或本地自构建），面板按需动态创建微信实例容器。不熟悉 Docker？直接看 [Docker 运行模式详解](#docker-运行模式详解新手向)。

---

## 工作原理（一句话）

每个微信实例 = 一个容器，里面跑 Xvfb 虚拟显示 + 官方原版微信，KasmVNC 把画面串到浏览器。同一实例被多个浏览器连 = 共享同一个微信会话。**不修改微信客户端**。

前面一层自研 **面板（panel）** 是唯一对外入口：负责账号登录、子账号与**实例权限**管理，经 docker 引擎**按需创建/销毁**微信实例容器，并反向代理到对应实例——浏览器只和面板打交道，KasmVNC 的凭据由面板在服务端注入，不下发前端。

```
浏览器 ──▶ panel(:36080) ──┬─ /               面板 SPA（登录 / 实例网格 / 子账号 / 进入桌面）
            cookie 鉴权     ├─ /api/*           账号、实例、权限接口
                           └─ /desktop/:id/*   反代 → 对应实例 KasmVNC（注入 Basic 鉴权）

panel ──(docker.sock)──▶ docker 引擎 ──▶ 按需创建/销毁微信实例容器 woc-wx-<id>
                                          每个实例 = 独立容器 + 独立数据卷 + 独立微信会话
                                          实例只在 docker 网络内暴露，不直连宿主
```

---

## Docker 运行模式详解（新手向）

如果你对 Docker 不熟，这一节把本项目「怎么跑起来的」讲透。读完你就能看懂上面的图。

### 0. 先认识 5 个 Docker 概念

| 概念 | 一句话理解 | 在本项目里是什么 |
|------|-----------|------------------|
| **镜像 Image** | 只读的「软件安装包」，里面装好了程序和依赖 | `woc-panel`（面板）、`wechat-on-cloud`（微信实例） |
| **容器 Container** | 镜像「运行起来」的实例，相当于「正在跑的程序」。一个镜像能跑出多个容器 | `woc-panel` 容器、多个 `woc-wx-<id>` 容器 |
| **卷 Volume** | 容器之外的持久磁盘。容器删了，卷里的数据还在 | 每个微信实例一个卷 `woc-data-<id>`，存登录态和消息 |
| **网络 Network** | 容器之间互通的「虚拟局域网」，容器之间可用**容器名**当域名互访 | 面板和所有实例在同一网络里，面板用 `http://woc-wx-<id>:3000` 找实例 |
| **docker.sock** | Docker 引擎的「遥控器」（宿主上的一个特殊文件 `/var/run/docker.sock`）。谁拿到它，谁就能指挥 Docker 创建/删除容器 | 挂进面板容器，面板才能「动态造微信实例」 |

> **Compose** 则是「用一个 `docker-compose.yml` 文件描述要跑哪些容器，`docker compose up -d` 一条命令拉起」。本项目的 compose 里**只有面板一个服务**。

### 1. 本项目有两类容器（运行角色不同）

这是本项目最容易迷惑的地方：**不是所有容器都写在 `docker-compose.yml` 里。**

| | ① 面板容器 | ② 微信实例容器 |
|---|-----------|---------------|
| 容器名 | `woc-panel`（固定一个） | `woc-wx-<随机id>`（可有多个） |
| 用哪个镜像 | `woc-panel` | `wechat-on-cloud` |
| 谁来启动 | **你** 执行 `docker compose up -d` | **面板**：你在网页点「新建微信实例」时，面板通过 docker.sock 自动 `docker run` |
| 写在 compose 里吗 | 是 | **否**（运行期动态创建，compose 里看不到） |
| 对外暴露端口 | 是，宿主 `36080` → 容器 `8080` | 否，只在 docker 网络内，由面板反代 |
| 数据存哪 | 宿主目录 `./data-panel` | 各自的命名卷 `woc-data-<id>` |
| 生命周期 | 常驻 | 你在面板「删除实例」时销毁（默认保留卷） |

一句话：**你只手动管面板这一个容器；微信实例是面板帮你按需开关的。** 这就是为什么面板要挂 `docker.sock`——它需要「遥控」Docker 去开关微信实例容器。

### 2. 镜像从哪来：两种「构建/获取」模式

容器要跑，先得有镜像。本项目的两个镜像有两条获取途径，**任选其一**（[快速开始](#快速开始)对应方式 A / B）：

| | 方式 A · 本地自构建 | 方式 B · 拉取官方镜像 |
|---|--------------------|----------------------|
| 怎么做 | `./scripts/build-local.sh`（用本仓库 Dockerfile 在你机器上造镜像） | `docker compose up -d`（自动从 GHCR 下载现成镜像） |
| 适合谁 | 官方还没发布镜像时 / 想自己改代码 / 内网无法访问 GHCR | 普通用户，开箱即用 |
| 前提 | 本机能拉到基础镜像（node、KasmVNC base） | GHCR 上已发布且包为公开（见[发布到 GHCR](#发布到-ghcr)） |
| 产物 | 本地镜像，标签和 compose 里写的一模一样 | 同名镜像，来自云端 |

> compose 的拉取策略是默认值（`missing`）：**本地已有同名镜像就直接用，没有才去 GHCR 拉**。所以方式 A 构建完，`docker compose up -d` 会直接用你的本地镜像，不会再联网。想升级到 GHCR 最新版：`docker compose pull && docker compose up -d`。

> 第三个「镜像」其实是**微信本体**：它**不打进任何镜像**，而是你在面板点「下载并安装」时，由实例容器实时从腾讯官方 CDN 下到自己的卷里（见[数据持久化](#数据持久化)）。

### 3. 从零到能用，整体发生了什么

```
你: docker compose up -d
      └─▶ Docker 读取 docker-compose.yml
            └─▶ 拉起【面板容器 woc-panel】，挂上 ./data-panel 和 docker.sock，暴露 36080 端口

你: 浏览器开 http://NAS:36080 → 登录 → 点「新建微信实例」
      └─▶ 面板通过 docker.sock 指挥 Docker:
            ├─ docker run 一个【微信实例容器 woc-wx-xxx】
            ├─ 给它挂一个新卷 woc-data-xxx（存登录态/消息）
            └─ 接到同一个 docker 网络（面板才能反代到它）

你: 进入该实例 → 点「下载并安装」
      └─▶ 面板 docker exec 进实例容器，触发脚本从腾讯 CDN 下载微信、解压到卷

你: 点「进入电脑版微信」→ 手机扫码
      └─▶ 浏览器 ⇄ 面板(反代+注入鉴权) ⇄ 实例容器的 KasmVNC ⇄ 微信窗口
```

### 4. 常用命令速查

```bash
docker compose up -d            # 启动面板（首次会拉/用镜像）
docker compose down             # 停止并删除面板容器（不动数据卷和微信实例）
docker compose pull             # 把面板/微信镜像更新到 GHCR 最新
docker ps                       # 看正在运行的容器（能看到 woc-panel 和各 woc-wx-*）
docker logs -f woc-panel        # 看面板日志
docker logs -f woc-wx-<id>      # 看某个微信实例日志
docker volume ls | grep woc     # 看所有微信实例的数据卷
```

> ⚠️ 微信实例容器请**始终在面板网页里增删**，不要手动 `docker rm` 它们——否则面板的实例登记和真实容器会对不上。

---

## 快速开始

> 需已安装 Docker（含 Compose 插件）。x86_64 / arm64 均可。

`docker-compose.yml` 引用的是 GHCR 上的镜像 `ghcr.io/gloridust/{woc-panel,wechat-on-cloud}`。
**这两个镜像需先存在**——要么官方已发布（你能直接拉取），要么你在本地自行构建。二选一：

**方式 A · 本地自构建（官方尚未发布镜像时用这个）**

```bash
git clone <this-repo> WechatOnCloud
cd WechatOnCloud
cp .env.example .env            # 至少改掉默认密码 WOC_PASSWORD
./scripts/build-local.sh        # 构建面板 + 微信实例镜像，打成 compose 用的同名标签
docker compose up -d            # compose 默认优先用本地镜像，不会再去 GHCR
```

**方式 B · 拉取官方镜像（已发布到 GHCR 后）**

```bash
git clone <this-repo> WechatOnCloud
cd WechatOnCloud
cp .env.example .env            # 至少改掉默认密码 WOC_PASSWORD
docker compose up -d            # 直接从 GHCR 拉取
```

> 报错 `error from registry: denied`？说明 GHCR 上还没有该镜像（或包是私有的）。用方式 A 本地构建，或见下方[「发布到 GHCR」](#发布到-ghcr)。

无论哪种方式，都会拉起面板容器 `woc-panel`（唯一对外服务）。浏览器访问 `http://<NAS_IP>:36080`：

1. 用 `.env` 里设置的管理员账号（默认 **admin / wechat**）登录面板；
2. 管理员在面板「实例」页点「**新建微信实例**」，命名并选择哪些子账号可访问 → 面板自动 `docker run` 起一个微信实例容器（微信镜像本地没有时才会从 GHCR 拉取）；
3. 进入该实例，点「**下载并安装**」微信（约 190~210MB，进度条实时显示，仅管理员可操作）；
4. 装好后点「进入电脑版微信」→ 浏览器里出现微信窗口，手机扫码登录即可。

之后被授权的用户换任意设备打开同一地址登录面板，看到自己有权访问的实例，进入即是**同一个**微信会话。

> 宿主只对外暴露面板的 `36080` 一个端口；微信实例容器仅在 docker 网络内、由面板反代，不直连宿主。要改端口/版本见 `.env`。

### 面板能做什么

| 功能 | 谁可用 | 说明 |
|------|--------|------|
| 新建 / 删除微信实例 | 管理员 | 一键创建独立微信会话容器；新建时勾选可访问的子账号。删除默认保留数据卷（聊天记录），可选彻底清除 |
| 实例权限分配 | 管理员 | 在实例上改「可访问账户」，或在账户上改「可访问实例」，双向管理 |
| 下载并安装 / 更新微信 | 管理员 | 对某实例一键下载官方微信 Linux 版到其数据卷、解压安装；带进度条；后续可一键「更新到最新版」 |
| 进入电脑版微信 | 被授权用户 | 在浏览器里操作对应实例的微信，扫码登录、收发消息 |
| 修改密码 | 所有人 | 改自己的登录密码 |
| 子账号管理 | 管理员 | 创建 / 禁用 / 重置 / 删除子账号，并分配实例访问权限 |
| 安装为 App | 所有人 | iOS Safari「添加到主屏幕」、桌面 Chrome「安装」当原生 App（PWA） |

> 子账号是**访问这套面板的身份**，不是另开一个微信。管理员隐式拥有全部实例访问权；子账号只能看到被授权的实例。

> 微信本体**不打进镜像**，而是新建实例后在面板点「下载并安装」时下载到该实例的数据卷，所以镜像很小、构建快、不依赖腾讯 CDN。

### 架构自动适配

镜像本身多架构（amd64/arm64）；下载微信时容器内**运行时再自动检测 CPU 架构**（`dpkg --print-architecture`）取对应官方包：

| 运行机器 | 架构 | 自动下载 |
|----------|------|----------|
| Intel/AMD NAS、x86 服务器 | amd64 | `WeChatLinux_x86_64.deb` |
| ARM NAS、Apple Silicon Mac | arm64 | `WeChatLinux_arm64.deb` |

到飞牛上（无论 x64 还是 arm）`docker compose up -d` 同一条命令，无需改任何架构相关配置。

### 自定义配置（可选）

复制 `.env.example` 为 `.env` 后按需修改，可配置项见 [.env.example](.env.example)：管理员账号密码、镜像版本（`WOC_VERSION`，建议上线后钉到具体版本）、PUID/PGID、时区、端口。

---

## 发布到 GHCR

仓库自带 GitHub Actions（[.github/workflows/release.yml](.github/workflows/release.yml)），在你**推送 `vX.Y.Z` 标签或发布 Release** 时，自动构建多架构（amd64+arm64）镜像并推到 GHCR：

```bash
git tag v1.0.0
git push origin v1.0.0     # 触发 Actions，产出 ghcr.io/<owner>/woc-panel:1.0.0 等标签
```

首次发布后还需把 GHCR 包设为公开，否则别人 `docker compose up -d` 会报 `denied`：

1. 打开 GitHub → 你的头像 → **Packages** → 分别进入 `woc-panel`、`wechat-on-cloud`；
2. **Package settings → Change visibility → Public**。

> 若想保持私有，则使用者需先 `docker login ghcr.io`（用具备 `read:packages` 的 PAT）才能拉取。
> 在镜像发布之前，本地用 `./scripts/build-local.sh` 自构建即可，无需等待发布。

---

## 数据持久化

- **面板数据**（用户、实例元信息、密码哈希）：容器内 `/data`，映射到宿主 `./data-panel`。
- **每个微信实例**：独立的 docker 命名卷 `woc-data-<id>`，挂到该实例容器的 `/config`（微信本体在 `/config/wechat`，登录态与消息缓存在 `/config` 其余位置）。

要点：
- 删除实例**默认保留**其数据卷，下次同名重建可复用；只有显式勾选「彻底清除」才会删卷。
- 备份某实例 = 备份对应的 `woc-data-<id>` 卷（`docker volume` 系列命令）。
- 卷需支持执行权限（微信本体直接从卷里运行）；放在 `noexec` 卷上微信将无法启动。
- 备份面板 = 备份 `./data-panel`。

> **从旧版（单微信容器 + `./data` 绑定挂载）迁移**：旧形态把微信数据放在宿主 `./data`。新版用 docker 命名卷，结构不同，无自动迁移。如需保留旧会话，最简单是新建一个实例、重新扫码登录；或手动把旧 `./data` 内容拷进新实例的 `woc-data-<id>` 卷。

---

## ⚠️ 安全须知（必读）

这套系统暴露的是**已登录的微信**——能登录面板的人就能看聊天记录、以你身份发消息。**面板还挂载了宿主的 `docker.sock`**（创建/销毁实例所需），它等同宿主 root 权限。因此：

- **绝不要把面板裸暴露公网**：只在内网访问，或经飞牛远程访问 / VPN / 内网穿透；
- 务必改掉默认密码（默认 admin / wechat）：`cp .env.example .env` 后改 `WOC_PASSWORD`，或登录后在「修改密码」里改；
- 实例的增删、微信安装/更新等触碰 docker 引擎的操作**仅限管理员**；docker API 绝不暴露给前端；
- KasmVNC 凭据由面板服务端注入，**浏览器永远拿不到**；实例容器名由内部随机 ID 派生，避免注入；
- 面板与外网之间再套一层 HTTPS 反代（飞牛自带反代 / Caddy / Nginx）获得正经 TLS；
- 进一步加固（陌生设备验证码、审计日志、并发控制）见 [技术方案.md](技术方案.md) 第 5 节。

---

## 中文输入

**用你本地（客户端）的输入法打中文，容器内无需安装任何 IME。** 镜像已默认开启 KasmVNC 的
「IME Input Mode」：拼音联想在你本机完成，只把成品汉字发进容器。直接在微信输入框打字即可。

- 默认值只对**未存过该设置的浏览器**生效。之前手动开/关过的，浏览器 localStorage 值优先；想验证默认效果用无痕窗口。
- 已知小毛病：超长拼音串未全部转成汉字就回车，偶尔丢字（[issue #97](https://github.com/linuxserver/docker-baseimage-kasmvnc/issues/97)），长句分段输入即可。
- 兜底：Chrome/Edge 下本地 `⌘C` → 远端 `Ctrl+V` 无缝粘贴；Firefox 用控制面板的 Clipboard 文本框中转。

## 常见问题

| 现象 | 排查 |
|------|------|
| 新建实例失败 | 多为面板拉不到微信镜像或连不上 docker.sock。确认 `docker.sock` 已挂载、宿主能访问 GHCR；看面板日志 `docker logs woc-panel` |
| 界面/消息显示成方块 | 中文字体没装好，确认实例镜像含 `fonts-noto-cjk` |
| 微信起不来 / 黑屏 | 看实例日志 `docker logs woc-wx-<id>`；确认 `seccomp=unconfined` 与 `shm_size` 生效。微信 deb 漏声明的运行时依赖已在 Dockerfile 内置 |
| 排查缺哪个库 | `docker exec woc-wx-<id> ldd /config/wechat/opt/wechat/wechat`，看 `not found` 项补进 Dockerfile 依赖层 |
| 多人同时操作很乱 | 单会话多端共享、键鼠会打架。未做并发控制，建议同一时刻一人操作（见技术方案 6.1） |
| 过段时间掉登录 | 微信桌面会话会定期失效，需手机重新扫码（见技术方案 6.2） |
| 下载 / 更新微信失败 | 腾讯 CDN 偶发波动，重新点「下载并安装 / 更新」即可；脚本已内置主/备 CDN 自动回退 |
| 架构不支持报错 | 微信仅提供 x86_64 / arm64；其他架构下载时会在面板状态里报错 |

查看面板日志：`docker logs -f woc-panel`；查看某实例日志：`docker logs -f woc-wx-<id>`（实例 ID 可在面板看到，或 `docker ps | grep woc-wx`）。

---

## 目录结构

```
WechatOnCloud/
├── .github/workflows/
│   └── release.yml        # 打 tag / 发 Release 时构建多架构镜像并推送 GHCR
├── docker/                # 微信实例镜像（ghcr.io/<owner>/wechat-on-cloud）
│   ├── Dockerfile         # KasmVNC base + 中文字体 + 微信运行时依赖 + 默认开 IME（不打包微信本体）
│   ├── wechat-ctl.sh      # 运行时下载/解压/更新微信（面板经 docker exec 触发，状态写 /config/.woc-state）
│   └── autostart          # openbox 会话启动：等待微信就绪 + 常驻拉起（含崩溃自重启）
├── panel/                 # 自研面板（ghcr.io/<owner>/woc-panel，唯一对外入口）
│   ├── Dockerfile         # 前端 Vite 打包 + 后端 Fastify 网关（多架构）
│   ├── server/            # Fastify：cookie 鉴权 + 账号/实例/权限 API + dockerode 管理实例 + 反代
│   └── web/               # React + TS + PWA（牛奶布艺 + 微信绿主题）
├── fnos/                  # 飞牛 fnOS 应用打包（.fpk 工程 + 构建说明）
├── scripts/
│   └── build-local.sh     # 本地构建面板+微信镜像（发布前自测 / 自托管自构建）
├── docker-compose.yml     # 单服务：panel（挂 docker.sock，按需创建实例）
├── .env.example           # 可选配置（账号密码、镜像版本、PUID/PGID、端口、时区）
├── 技术方案.md            # 完整设计文档
└── README.md
```

数据：面板账号（含密码哈希）在 `./data-panel`，各微信实例在 docker 命名卷 `woc-data-<id>`；`./data-panel` 已在 `.gitignore` 中。

---

## 路线图

- [x] MVP：Docker + 微信原生版 + KasmVNC，浏览器扫码登录、收发消息
- [x] 自研面板：cookie 鉴权 + 反代 + 子账号管理 + PWA（KasmVNC 凭据不下发前端）
- [x] 微信本体运行时下载到数据卷：面板一键「下载并安装 / 更新」，带进度条
- [x] 多实例管理 + 按账号的实例访问权限（RBAC）
- [x] 预构建多架构镜像发布到 GHCR + GitHub Actions 自动化
- [ ] 面板外层 TLS / 陌生设备验证码 / 审计日志
- [ ] 多端并发控制（控制权令牌）
- [ ] 掉登录时 web 端二维码重扫入口
- [~] 打包成飞牛原生 fpk 分发（工程已就绪见 [fnos/](fnos/)，待真实设备验证 docker.sock 权限）
