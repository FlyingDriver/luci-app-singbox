# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [1.0.1] - 2026-11-02

性能与稳定性修复。经 8 次真实重启验证。

### 修复

- **概览页轮询卡顿 3–10 秒**：原先用 `wget + head` 读取 Clash API 的 `/traffic`
  （SSE 流式接口，永不关闭），必须等下一帧推送，实测稳定阻塞 **3016 ms**；
  而概览页每 5 秒轮询一次，导致页面长期"转圈"。
  改用 `/connections` 的累计字节差分算速率（后端新增 `up_rate` / `down_rate` 字段），
  延迟从 3 s 降至 **15 ms**。

- **移除明文 HTTP 第三方查询**：概览页原先请求 `http://ip-api.com/json/` 获取
  代理 IP 归属地。改用仅 HTTPS 的 `api.ipify.org`，并加 `sessionStorage` 5 分钟缓存，
  避免每次开页都把出口 IP 报给第三方。

- **`install-openwrt.sh` 与 `install.sh` 合并**：两者功能高度重复（165/162 行），
  合并为单一 `install.sh`，保留 apk/opkg 双体系支持与更完整的清理逻辑。

### 文档

- README 新增「性能实测」章节，给出真机各项耗时数据
- README 新增「已知限制」章节，说明 5 项有意为之的设计取舍
- README 新增「部署时必须注意的两件事」：`cache_file` 持久化、开机首个 CGI 阻塞
- 补齐 `docs/screenshots/` 真实设备截图（概览/节点/路由/日志）
- 修正 README 与 `packaging/README.md` 中的文件引用与表格语法

### 部署提示

如果你从 1.0.0 升级，请确认 sing-box 配置里的 `cache_file.path` 指向**持久存储**：

```json
"cache_file": { "enabled": true, "path": "/etc/sing-box/cache.db", "store_fakeip": true }
```

放在 `/tmp`（tmpfs）会导致重启后 fake-ip 映射丢失，引发 `missing fakeip record`
与控制台首次打开缓慢（实测 22–30 s）。

---

## [1.0.0] - 2026-11-02

首个公开版本。

### 新增

- **概览**：服务启停/重启、运行模式切换、实时速率与累计流量、内存/负载/CPU、
  本地与代理双出口 IP、6 站点访问检查、快捷操作
- **节点**：节点列表与分组、延迟测速、一键切换（局部刷新）、节点增删改
- **路由**：规则查看与编辑、关键字搜索（含规则集内部深层搜索）、
  同出站规则一键合并、规则增删改与排序
- **规则集编辑**：`.srs` 反编译为明细，逐条增删改后重新编译
- **日志**：实时日志、级别筛选、关键词搜索、自动区分真实错误与预期内错误
- **Zashboard 集成**：可选的完整 Clash API 面板，同源 iframe 内嵌，自动配置后端
- `install.sh`：安装 / 卸载 / 环境自检（apk + opkg 通用）
- `setup-zashboard.sh`：Zashboard 一键集成（含资源裁剪与 nginx 反代生成）
- `packaging/`：OpenWrt SDK Makefile + 独立 `.ipk` 构建脚本

### 设计要点

- 纯 ucode 后端 + 原生 JS 前端，零编译、零额外依赖
- Clash API 只监听 127.0.0.1，密钥由服务端注入，永不出设备
- 所有写操作先备份 + `sing-box check` 校验通过才落盘
- 不硬编码 IP/端口/密码，全部从 sing-box 配置动态读取
- Clash API 请求 500ms 短 TTL 缓存，减少重复调用
- 节点编辑用 `__keep_secret__` 机制继承凭据，密码/UUID 永不下发到前端

### 已知限制

- sing-box 1.12 的 Clash API `mode-list` 仅支持 `rule`，
  全局/直连模式用「改变 final 出站指向」等效实现
- 规则集首次展开需反编译，大规则集（2 万+ 条）约 2-5 秒
