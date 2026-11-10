# 打包与发布

本目录提供三种分发方式，按目标设备选择：

| 方式 | 文件 | 适用 | 需要 SDK |
|---|---|---|---|
| **一键脚本**（推荐） | `install.sh` + 源码 | 所有 OpenWrt/ImmortalWrt | ❌ |
| **ipk 包** | `dist/*.ipk` | OpenWrt ≤ 23.05（opkg） | ❌ |
| **SDK 构建** | `packaging/Makefile` | 官方 feed 提交 / 全架构 | ✅ |

---

## 1. 一键脚本（所有版本通用，推荐）

```sh
# 本地打包
tar czf luci-app-singbox-1.0.2.tar.gz \
  --exclude='./dist' --exclude='./.build*' \
  -C luci-app-singbox .

# 上传到路由器并安装
scp luci-app-singbox-1.0.2.tar.gz root@192.168.1.1:/tmp/
ssh root@192.168.1.1 '
  cd /tmp && tar xzf luci-app-singbox-1.0.2.tar.gz -C luci-app-singbox --one-top-level 2>/dev/null ||
  (mkdir -p luci-app-singbox && tar xzf luci-app-singbox-1.0.2.tar.gz -C luci-app-singbox)
  cd luci-app-singbox && sh install.sh
'
```

优点：**不依赖包管理器**，apk / opkg 系统都能用。

---

## 2. ipk 包（OpenWrt ≤ 23.05）

```sh
sh packaging/build-ipk.sh
# 产物：dist/luci-app-singbox_1.0.2-1_all.ipk

scp dist/*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1 'opkg install /tmp/luci-app-singbox_1.0.2-1_all.ipk'
```

依赖：`ar` 命令（`apt install binutils`）。

> **注意**：OpenWrt **24.10+ / ImmortalWrt 25.x 使用 apk**，
> apk v3 是 ADB 二进制格式，**无法用 tar.gz 手工构造**，
> 必须用 SDK 构建或改用上面的「一键脚本」。

---

## 3. SDK 构建（官方 feed 提交 / 生成 apk）

```sh
# 1. 下载对应版本的 OpenWrt SDK
wget https://downloads.openwrt.org/releases/24.10.0/targets/.../openwrt-sdk-*.tar.zst
tar xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*

# 2. 把本插件放进 package/
mkdir -p package/luci-app-singbox
cp -r /path/to/luci-app-singbox/{usr,www,Makefile} package/luci-app-singbox/

# 3. 编译
make defconfig
make package/luci-app-singbox/compile V=s

# 4. 产物
find bin/ -name 'luci-app-singbox*'
# → bin/packages/<arch>/base/luci-app-singbox_1.0.2-1_all.ipk  (opkg)
# → bin/packages/<arch>/base/luci-app-singbox-1.0.2-r1.apk     (apk)
```

**提交到 openwrt/luci 上游**：

```
# fork https://github.com/openwrt/luci
# 把本目录放到 applications/luci-app-singbox/
# 提交 PR，标题：luci-app-singbox: add sing-box management UI
```

---

## 版本号约定

`PKG_VERSION-PKG_RELEASE`，例如 `1.0.2-1`：

- `PKG_VERSION`：语义化版本，功能变更时递增
- `PKG_RELEASE`：同一版本内的打包修订号

---

## 发布清单

每次发布需更新：

- [ ] `packaging/Makefile` 的 `PKG_VERSION` / `PKG_RELEASE`
- [ ] `packaging/build-ipk.sh` 的 `PKG_VERSION` / `PKG_RELEASE`
- [ ] `CHANGELOG.md`
- [ ] `README.md` 的版本徽章（如有）
