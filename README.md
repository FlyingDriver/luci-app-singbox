# luci-app-singbox

> 给 [sing-box](https://github.com/SagerNet/sing-box) 一个现代化的 LuCI 可视化管理界面 —— 纯静态文件 + ucode，零编译、零额外依赖。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-OpenWrt-00b5e2.svg)](https://openwrt.org)
[![sing-box](https://img.shields.io/badge/sing--box-%E2%89%A51.10-orange.svg)](https://github.com/SagerNet/sing-box)

---

## 特性

| 模块 | 功能 |
|---|---|
| **概览** | 服务启停/重启、运行模式切换、实时速率与累计流量、内存/负载/CPU、**本地与代理双出口 IP**、6 站点访问检查、快捷操作 |
| **节点** | 节点列表与分组、延迟测速、一键切换（局部刷新，无整页重载）、节点增删改 |
| **路由** | 分流规则查看与编辑、**关键字搜索（含规则集内部深层搜索）**、**同出站规则一键合并**、规则增删改与排序、**规则集（.srs）反编译为明细逐条编辑并重新编译** |
| **日志** | 实时日志、级别筛选、关键词搜索、自动滚动 |
| **Zashboard** | 可选集成完整 Clash API 面板（同源 iframe 内嵌，自动配置后端） |

### 设计亮点

- **零依赖**：纯 ucode 后端 + 原生 JS 前端，不需要 Lua、不需要编译、不需要 Python
- **安全**：Clash API 只监听 `127.0.0.1`，密钥由 rpcd/nginx 服务端注入，**永不出设备**
- **防呆**：所有写操作先备份 + `sing-box check` 校验通过才落盘；校验失败原配置不动
- **通用**：不硬编码 IP/端口/密码，全部从 `/etc/sing-box/config.json` 动态读取
- **轻量**：低配路由（512 MB 内存 / 双核 ARM）实测零卡顿；实测内存增量 < 2 MB

### 性能实测

在斐讯 K3（BCM47094，2×Cortex-A9 1.4 GHz，512 MB RAM，**无 FPU/NEON**）上：

| 操作 | 耗时 |
|---|---|
| 概览页首次加载（稳态） | 0.10 s |
| 5 个页面全部打开 | 每页 0.098–0.105 s |
| 轮询请求（每 5 s 一次） | 50–52 ms |
| `run_stats` RPC | 0–1 ms |
| 后端 ucode 模块 | 42 KB（24 个 RPC） |
| 前端 JS + CSS | 30 KB |
| 插件总占用 | ≈ 660 KB（含规则集） |

> 所有 RPC 都避免了对 **SSE 流式接口**的同步读取。Clash API 的 `/traffic` 是永不关闭的长连接，
> 用 `wget + head` 读它必须等下一帧（实测稳定阻塞 3016 ms）。本插件改用 `/connections`
> 的累计字节做差分算速率，延迟从 3 s 降到 15 ms。

---

## 界面预览

插件提供 5 个页面：

| 页面 | 内容 |
|---|---|
| **概览** | 服务控制、运行模式切换、实时速率与流量、内存/负载/CPU、双出口 IP、6 站点访问检查、快捷操作 |
| **节点** | 节点列表（按协议打标签）、延迟测速、分组切换、节点增删改 |
| **路由** | 分流规则列表、规则集明细、关键字搜索（含规则集内部）、合并、排序、增删改 |
| **日志** | 实时日志、级别筛选、关键词搜索、自动区分真实错误与预期内错误 |
| **Zashboard** | 可选集成完整 Clash API 面板（同源 iframe，自动配置后端） |

> UI 采用与 OpenWrt 主流主题（Argon / Bootstrap）协调的卡片式布局，
> 移动端自适应。截图会随 Issue/PR 由社区补充。

---

## 环境要求

| 项 | 要求 |
|---|---|
| OpenWrt | 21.02+ / ImmortalWrt（使用 `apk` 或 `opkg` 均可） |
| LuCI | 基于 JS 的新版 LuCI（`luci-base` ≥ 21.02） |
| ucode | 必须（`opkg install ucode` / `apk add ucode`） |
| sing-box | ≥ 1.10（推荐 1.11+，`experimental.clash_api` 必须启用） |
| 可选 | `nginx`（仅 Zashboard 集成需要） |

> **实测环境**：斐讯 K3（BCM47094，2×Cortex-A9 1.4GHz，512 MB RAM），ImmortalWrt 25.12.2，sing-box 1.12.25

---

## 安装

### 方式一：一键脚本（推荐）

```sh
# 在路由器上执行（或先 scp 上去）
wget -O - https://raw.githubusercontent.com/<your-name>/luci-app-singbox/main/install.sh | sh
```

或手动：

```sh
scp -r luci-app-singbox root@192.168.1.1:/tmp/
ssh root@192.168.1.1
cd /tmp/luci-app-singbox && sh install.sh
```

### 方式二：手动复制

```sh
# 后端
cp usr/share/rpcd/ucode/luci.singbox            /usr/share/rpcd/ucode/
cp usr/share/rpcd/acl.d/luci-app-singbox.json   /usr/share/rpcd/acl.d/
cp usr/share/luci/menu.d/luci-app-singbox.json  /usr/share/luci/menu.d/

# 前端
mkdir -p /www/luci-static/resources/singbox /www/luci-static/resources/view/singbox
cp www/luci-static/resources/singbox.css         /www/luci-static/resources/
cp www/luci-static/resources/singbox/common.js   /www/luci-static/resources/singbox/
cp www/luci-static/resources/view/singbox/*.js   /www/luci-static/resources/view/singbox/

chmod 755 /usr/share/rpcd/ucode/luci.singbox
rm -f /tmp/luci-indexcache*
/etc/init.d/rpcd restart
```

安装后访问：**LuCI → 服务 → sing-box**

### 卸载

```sh
sh install.sh uninstall
```

> 只删除插件文件，**不删除** sing-box 配置与备份。

### 环境自检

```sh
sh install.sh check
```

输出 ucode 是否可用、sing-box 配置是否存在、Clash API 是否启用、后端是否注册等。

---

## 前置配置：启用 Clash API

插件完全依赖 sing-box 的 Clash API。请在 `/etc/sing-box/config.json` 中确认：

```json
{
  "experimental": {
    "clash_api": {
      "external_controller": "127.0.0.1:9090",
      "secret": "换成你自己的随机字符串"
    }
  }
}
```

然后重启服务：

```sh
/etc/init.d/singbox restart
```

> `external_controller` 建议**只监听 127.0.0.1**。插件通过 rpcd 后端代理访问，无需对外开放。

---

## Zashboard 集成（可选）

[Zashboard](https://github.com/Zephyruso/zashboard) 是一个功能完整的 Clash API 面板。本插件的 `setup-zashboard.sh` 会自动完成：

1. 下载 Zashboard 到 `/www/zashboard/`
2. 裁剪 emoji 字体与地球动画（省 ~2.7 MB）
3. 生成 nginx 反代配置，自动注入 Clash API 密钥
4. 打通 LuCI 内嵌（同源 iframe）

```sh
sh setup-zashboard.sh           # 安装
sh setup-zashboard.sh --force   # 强制重装
sh setup-zashboard.sh remove    # 移除
```

安装后：

- 独立访问：`http://<路由器IP>/zashboard/`
- LuCI 内嵌：**服务 → sing-box → Zashboard**

---

## 使用说明

### 运行模式的真实含义

sing-box 1.12 的 Clash API `mode-list` **只支持 `rule`**，无法像 mihomo 那样切 `global`/`direct`。
本插件用**等效实现**：

| 界面选择 | 实际动作 | 效果 |
|---|---|---|
| 规则 | `🐟 漏网之鱼` → `♻️ 自动选择` | 规则表正常分流 |
| 全局 | `🐟 漏网之鱼` → `🔰 节点选择` | 未命中规则的流量全走代理 |
| 直连 | `🐟 漏网之鱼` → `🎯 全球直连` | 未命中规则的流量全直连 |

> ⚠️ 已命中规则的流量不受模式影响。这是 sing-box 架构决定，与 mihomo 行为不同。
> 如果你的 `final` 出站名字不同，请修改 `overview.js` 中的 `🐟 漏网之鱼`。

### 规则集（.srs）明细编辑

带 `规则集` 标记的规则，点「明细」可展开内部条目：

```
规则集明细：geosite-cn
  [+ 添加条目] [保存并编译]      共 9378 条
  类型            值              操作
  domain          taobao.com      删
  domain_suffix   .qq.com         删
  ...
```

保存流程：`items → JSON → sing-box rule-set compile → 覆盖 .srs`（自动备份 `.bak-luci`）。

> 大数据量规则集（如 24000 条的 geosite-!cn）首次展开需反编译，约 2-5 秒。
> 条目数在列表页显示为 `-1` 表示尚未统计，点开即会计算并缓存。

### 规则合并

点「合并重复规则」会把**出站目标相同**的多条规则聚合成一条：

```json
// 合并前（5 条）
{ "rule_set": ["pi-b02"], "outbound": "🌍 国外媒体" }
{ "rule_set": ["pi-b04"], "outbound": "🌍 国外媒体" }
{ "rule_set": ["pi-b09"], "outbound": "🌍 国外媒体" }
...

// 合并后（1 条）
{ "rule_set": ["pi-b02","pi-b04","pi-b09",...], "outbound": "🌍 国外媒体" }
```

**安全性**：只在同出站内合并，跨组优先级完全不变。合并前自动备份。

### IP 地址卡片

- **本地出口**：由后端用国内源（`ip.3322.net` / `myip.ipip.net`）查询，反映运营商 IP
- **代理出口**：由**浏览器**查询（浏览器流量已由路由器透明代理），反映代理节点 IP 与归属地

> 为什么代理 IP 不在后端查？因为路由器自身流量通常不经 tproxy，后端用 wget 走 HTTPS 代理访问境外站会长时间阻塞并触发 rpcd 30 秒超时。改由浏览器查询既准确又快速。

---

## 架构

```
┌─────────────────────────────────────────────────────────┐
│  浏览器（LuCI 页面）                                      │
│    overview / nodes / rules / logs / zashboard           │
└────────────────┬────────────────────────┬───────────────┘
                 │ rpcd/ubus (JSON-RPC)   │ iframe (同源)
                 ▼                        ▼
┌──────────────────────────────┐  ┌──────────────────────┐
│  /usr/share/rpcd/ucode/      │  │  /www/zashboard/     │
│    luci.singbox  (24 个 RPC) │  │  (uhttpd:80)         │
└──────────────┬───────────────┘  └──────────┬───────────┘
               │ HTTP (127.0.0.1)            │ /api (8080)
               ▼                             ▼
┌──────────────────────────────┐  ┌──────────────────────┐
│  sing-box Clash API :9091    │◄─┤  nginx 反代 + 注入密钥 │
└──────────────────────────────┘  └──────────────────────┘
               │
               ▼
      /etc/sing-box/config.json
```

### 后端 RPC 一览

| 方法 | 说明 |
|---|---|
| `status` | 服务状态、版本、节点数、规则数 |
| `service` | 启动 / 停止 / 重启 |
| `clash_get` | 代理访问 Clash API（500 ms 短缓存） |
| `nodes_list` / `node_save` / `node_delete` / `test_node` / `select_node` | 节点管理 |
| `rules_list` / `rules_save` / `rules_merge` | 规则管理 |
| `ruleset_list` / `ruleset_read` / `ruleset_save` | 规则集反编译与重编译 |
| `logs_read` | 系统日志读取 |
| `run_stats` / `ip_check` / `access_check` | 运行数据与连通性检测 |
| `flush_dns` / `close_connections` | 辅助操作 |
| `backup_list` | 列出配置备份 |
| `set_mode` | Clash 模式（受 sing-box 限制，仅 rule） |

---

## 已知限制

这些是**有意为之的取舍**，不是缺陷：

| 限制 | 原因 |
|---|---|
| **运行模式仅有 `rule`** | sing-box 1.12 的 Clash API `mode-list` 只返回 `["rule"]`，`global` / `direct` 是 mihomo 扩展，sing-box 不支持。插件如实显示，不伪造选项。 |
| **规则集（.srs）反编译是"尽力而为"** | `.srs` 是二进制格式，反编译出的明细可能与原始 YAML 在**注释和顺序**上有差异。改动后重新编译得到的是等价规则集，不是字节级还原。 |
| **不支持编辑 `route.rules` 之外的配置** | 插件聚焦分流规则与节点管理。DNS、inbound、outbound 的高级参数请直接编辑 `config.json`。 |
| **Zashboard 需要额外一步** | 它是第三方面板（2.5 MB 静态资源），不随插件包分发。运行 `setup-zashboard.sh` 单独安装。 |
| **修改配置会重启 sing-box** | 保存规则/节点后需要重载服务才能生效（约 1–2 秒断流）。这是 sing-box 的机制，无法热重载全部配置。 |

### 部署时必须注意的两件事

**① `experimental.cache_file` 必须指向持久存储**

```json
{
  "experimental": {
    "cache_file": {
      "enabled": true,
      "path": "/etc/sing-box/cache.db",
      "store_fakeip": true
    }
  }
}
```

如果放在 `/tmp`（tmpfs），重启后 fake-ip 映射表会丢失并在新会话中重新分配，
而 dnsmasq 的 DNS 缓存（`cachesize`）跨重启保留 → 客户端拿到**上一轮的旧 fake-ip**
→ sing-box 查不到映射，日志刷 `missing fakeip record`，且每次访问都要重新走代理查 DNS。

实测影响：管理页面首次打开从 0.1 s 恶化到 **22–30 s**。

**② 开机后第一个 LuCI CGI 会阻塞约 30 s（与本插件无关）**

这是 LuCI 自身的首次初始化开销（加载模板 + 全部 i18n 翻译），超过 uhttpd 的
`script_timeout`（默认 30）会返回 502。任何页面作为"开机后第一个 CGI 请求"都会触发。

缓解方式（可选）：

```sh
# 开机后主动预热一次，用户就再也碰不到这 30 秒
cat > /usr/bin/luci-warmup <<'EOF'
#!/bin/sh
i=0
while [ $i -lt 120 ]; do
    netstat -tln 2>/dev/null | grep -q ":80 " && break
    sleep 0.5; i=$((i+1))
done
[ $i -ge 120 ] && exit 0
sleep 3
logger -t luci-warmup "warming up LuCI CGI"
wget -qO- -T 40 "http://127.0.0.1/cgi-bin/luci/" >/dev/null 2>&1
EOF
chmod 755 /usr/bin/luci-warmup
sed -i 's|^exit 0|/usr/bin/luci-warmup \&\n\nexit 0|' /etc/rc.local
```

---

## 常见问题

<details>
<summary><b>安装后菜单里看不到 sing-box</b></summary>

```sh
rm -f /tmp/luci-indexcache*
/etc/init.d/rpcd restart
/etc/init.d/uhttpd restart   # 或 nginx
```
然后强制刷新浏览器（Ctrl+Shift+R）。
</details>

<details>
<summary><b>页面能打开但数据全是 0 / 提示无法读取配置</b></summary>

Clash API 未启用或端口/密钥不匹配。检查：

```sh
grep -A3 clash_api /etc/sing-box/config.json
wget -qO- --header="Authorization: Bearer <你的secret>" \
  http://127.0.0.1:9090/version
```
</details>

<details>
<summary><b>保存规则报「配置校验失败」</b></summary>

说明生成的 JSON sing-box 不认。常见原因：

- 匹配条件写成了数组而非对象，例如 `[{"domain":"x"}]`（应为 `{"domain":["x"]}`）
- 布尔字段（`ip_is_private`）被误写成数组
- 引用了不存在的 `rule_set` tag

校验失败**不会影响现有配置**，修正后重试即可。
</details>

<details>
<summary><b>规则集明细展开很慢 / 显示 -1 条</b></summary>

首次需 `sing-box rule-set decompile`，大规则集（2 万+ 条）约 2-5 秒。
条目数缓存在 `/tmp/sb-rs-count-*`，重启后清空。显示 `-1` 表示未统计，点开即算。
</details>

<details>
<summary><b>Zashboard 显示「后端连不上」</b></summary>

Zashboard 把后端配置存在浏览器 `localStorage`（键 `setup/api-list` / `setup/active-uuid`），
一旦存过错误值就会一直用。插件页面会**自动修正**这两个键。

如仍异常，手动清理：
```js
localStorage.removeItem('setup/api-list');
localStorage.removeItem('setup/active-uuid');
```
然后重新打开页面。
</details>

<details>
<summary><b>日志刷 ERROR: open connection to x.x.x.x:port using outbound/block</b></summary>

被规则 REJECT 的连接会记 ERROR。如果这些是**内网地址**且你希望它们直通，
应该在 nft 层绕过，而不是在 sing-box 规则里处理：

```sh
# 编辑 /etc/sing-box/nft-rules.nft，在 prerouting chain 内加入：
ip daddr <内网段> return
```

这样流量根本不进 tproxy，既不会报错，也不会等超时。
</details>

---

## 目录结构

```
luci-app-singbox/
├── README.md                       # 本文档
├── CHANGELOG.md                    # 版本记录
├── LICENSE                         # MIT
├── install.sh                      # 安装 / 卸载 / 自检（apk + opkg 通用）
├── setup-zashboard.sh              # Zashboard 集成（可选）
├── packaging/
│   ├── Makefile                    # OpenWrt SDK 构建（提交官方 feed 用）
│   ├── build-ipk.sh                # 独立构建 .ipk（无需 SDK）
│   └── README.md                   # 三种分发方式说明
├── usr/share/
│   ├── rpcd/ucode/luci.singbox                 # 后端（ucode，24 个 RPC）
│   ├── rpcd/acl.d/luci-app-singbox.json        # 权限（read 12 / write 12）
│   └── luci/menu.d/luci-app-singbox.json       # 菜单注册
└── www/luci-static/resources/
    ├── singbox.css                 # 设计系统（27 KB）
    ├── singbox/common.js           # 公共模块（RPC 声明 / 组件 / 工具）
    └── view/singbox/
        ├── overview.js             # 概览
        ├── nodes.js                # 节点
        ├── rules.js                # 路由规则
        ├── logs.js                 # 日志
        └── zashboard.js            # 第三方面板集成
```

---

## 开发

无构建步骤。改完直接跑 `sh install.sh` 即可生效。

```sh
# 后端语法检查
ucode -c usr/share/rpcd/ucode/luci.singbox

# 前端语法检查
node --check www/luci-static/resources/view/singbox/rules.js

# 清 LuCI 缓存（前端改动后必做）
rm -f /tmp/luci-indexcache*
```

### 调试技巧

- 浏览器控制台错误：看 `luci.singbox` 的 RPC 响应
- 后端日志：`logread | grep -E 'rpcd|singbox'`
- 强制刷新静态资源（LuCI 带 `?v=<version>` 查询串）：
  ```js
  await fetch('/luci-static/resources/view/singbox/rules.js?v=26.249.28459~d6167ea',
              { cache: 'reload' });
  location.reload();
  ```

---

## 贡献

欢迎 Issue 与 PR。提交前请：

1. 确认 `ucode -c` 与 `node --check` 都通过
2. 在真机上验证过关键路径（保存规则 / 切换节点 / 重启服务）
3. UI 改动附截图

---

## 许可

[MIT](LICENSE)

## 致谢

- [sing-box](https://github.com/SagerNet/sing-box) —— 核心
- [Zashboard](https://github.com/Zephyruso/zashboard) —— Clash API 面板
- [OpenWrt](https://openwrt.org) / [LuCI](https://github.com/openwrt/luci) —— 平台
