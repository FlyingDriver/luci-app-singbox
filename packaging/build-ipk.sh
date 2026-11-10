#!/bin/sh
# ============================================================================
# 在普通 Linux 机器上构建 luci-app-singbox 的 .ipk 包（无需 OpenWrt SDK）
#
# 依赖：tar, gzip, ar（binutils）
#   Debian/Ubuntu: apt install binutils
#   macOS:         brew install binutils
#
# 用法：
#   sh packaging/build-ipk.sh              # 构建 ipk
#   sh packaging/build-ipk.sh clean        # 清理
#
# 产物：dist/luci-app-singbox_<version>_all.ipk
# ============================================================================

set -e

PKG_NAME="luci-app-singbox"
PKG_VERSION="1.0.2"
PKG_RELEASE="1"
PKG_ARCH="all"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
WORK="$ROOT/.build"
PKG_DIR="$WORK/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}"

# ── 颜色 ──────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
	C_G='\033[32m'; C_Y='\033[33m'; C_E='\033[31m'; C_R='\033[0m'
else
	C_G=''; C_Y=''; C_E=''; C_R=''
fi
ok()   { printf "${C_G}✓${C_R} %s\n" "$*"; }
info() { printf "→ %s\n" "$*"; }
err()  { printf "${C_E}✗${C_R} %s\n" "$*"; }

clean() {
	info "清理构建产物"
	rm -rf "$WORK" "$DIST"
	ok "已清理"
	exit 0
}

[ "$1" = "clean" ] && clean

# ── 检查依赖 ──────────────────────────────────────────────────────────────
command -v ar >/dev/null 2>&1 || { err "缺少 ar 命令：apt install binutils"; exit 1; }
command -v tar >/dev/null 2>&1 || { err "缺少 tar"; exit 1; }

info "构建 $PKG_NAME $PKG_VERSION-$PKG_RELEASE ($PKG_ARCH)"

# ── 准备目录 ──────────────────────────────────────────────────────────────
rm -rf "$WORK"
mkdir -p "$PKG_DIR/control" "$PKG_DIR/data" "$DIST"

DATA="$PKG_DIR/data"

# ── 复制文件 ──────────────────────────────────────────────────────────────
info "复制运行文件"

# 后端
mkdir -p "$DATA/usr/share/rpcd/ucode"
cp "$ROOT/usr/share/rpcd/ucode/luci.singbox" "$DATA/usr/share/rpcd/ucode/"

# 权限
mkdir -p "$DATA/usr/share/rpcd/acl.d"
cp "$ROOT/usr/share/rpcd/acl.d/luci-app-singbox.json" "$DATA/usr/share/rpcd/acl.d/"

# 菜单
mkdir -p "$DATA/usr/share/luci/menu.d"
cp "$ROOT/usr/share/luci/menu.d/luci-app-singbox.json" "$DATA/usr/share/luci/menu.d/"

# 前端
mkdir -p "$DATA/www/luci-static/resources/singbox"
mkdir -p "$DATA/www/luci-static/resources/view/singbox"
cp "$ROOT/www/luci-static/resources/singbox.css" "$DATA/www/luci-static/resources/"
cp "$ROOT/www/luci-static/resources/singbox/common.js" "$DATA/www/luci-static/resources/singbox/"
cp "$ROOT/www/luci-static/resources/view/singbox/"*.js "$DATA/www/luci-static/resources/view/singbox/"

# 可选：安装/集成脚本（放 /usr/share/luci-app-singbox/ 供手动调用）
mkdir -p "$DATA/usr/share/luci-app-singbox"
cp "$ROOT/install.sh" "$DATA/usr/share/luci-app-singbox/"
cp "$ROOT/setup-zashboard.sh" "$DATA/usr/share/luci-app-singbox/"
cp "$ROOT/README.md" "$DATA/usr/share/luci-app-singbox/"

# ── 设置权限 ──────────────────────────────────────────────────────────────
info "设置文件权限"
chmod 755 "$DATA/usr/share/rpcd/ucode/luci.singbox"
chmod 755 "$DATA/usr/share/luci-app-singbox/install.sh"
chmod 755 "$DATA/usr/share/luci-app-singbox/setup-zashboard.sh"
chmod 644 "$DATA/usr/share/rpcd/acl.d/luci-app-singbox.json"
chmod 644 "$DATA/usr/share/luci/menu.d/luci-app-singbox.json"
chmod 644 "$DATA/www/luci-static/resources/singbox.css"
chmod 644 "$DATA/www/luci-static/resources/singbox/common.js"
chmod 644 "$DATA/www/luci-static/resources/view/singbox/"*.js
chmod 644 "$DATA/usr/share/luci-app-singbox/README.md"

# ── 计算包大小 ────────────────────────────────────────────────────────────
INSTALLED_SIZE=$(du -sk "$DATA" | cut -f1)

# ── control 文件 ──────────────────────────────────────────────────────────
info "生成 control 元数据"
cat > "$PKG_DIR/control/control" <<EOF
Package: $PKG_NAME
Version: $PKG_VERSION-$PKG_RELEASE
Depends: libc, ucode, ucode-mod-fs, ucode-mod-uci, rpcd, sing-box
Provides: luci-app-singbox
Source: https://github.com/your-name/luci-app-singbox
SourceName: $PKG_NAME
License: MIT
LicenseFiles: LICENSE
Section: luci
Section-Priority: 1
SourceDateEpoch: $(date +%s)
Maintainer: luci-app-singbox contributors
Architecture: $PKG_ARCH
Installed-Size: $INSTALLED_SIZE
Description: LuCI support for sing-box
 Web UI for sing-box: service control, node management with latency
 testing, routing rule editing (including rule-set internals), live logs,
 and optional zashboard panel integration.
EOF

# postinst：清缓存 + 重启 rpcd
cat > "$PKG_DIR/control/postinst" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

rm -f /tmp/luci-indexcache* 2>/dev/null
/etc/init.d/rpcd restart >/dev/null 2>&1

echo "luci-app-singbox 已安装"
echo "访问：LuCI → 服务 → sing-box"
exit 0
EOF

# prerm：清理运行时缓存
cat > "$PKG_DIR/control/prerm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

rm -f /tmp/luci-indexcache* 2>/dev/null
rm -f /tmp/sb-rs-count-* /tmp/sb-rs-*.json 2>/dev/null
exit 0
EOF

# postrm：重启 rpcd 使菜单刷新
cat > "$PKG_DIR/control/postrm" <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0

rm -f /tmp/luci-indexcache* 2>/dev/null
/etc/init.d/rpcd restart >/dev/null 2>&1
exit 0
EOF

chmod 755 "$PKG_DIR/control/postinst" "$PKG_DIR/control/prerm" "$PKG_DIR/control/postrm"

# conffiles：无可保留的配置文件（本插件不写 /etc/config）
: > "$PKG_DIR/control/conffiles"

# ── 打包：control.tar.gz + data.tar.gz + debian-binary → ar ───────────────
info "打包"

( cd "$PKG_DIR/control" && tar czf "$PKG_DIR/control.tar.gz" --owner=0 --group=0 ./control ./postinst ./prerm ./postrm ./conffiles 2>/dev/null || \
  tar czf "$PKG_DIR/control.tar.gz" --owner=0 --group=0 ./control ./postinst ./prerm ./postrm )
( cd "$DATA" && tar czf "$PKG_DIR/data.tar.gz" --owner=0 --group=0 ./ )

printf '2.0\n' > "$PKG_DIR/debian-binary"

IPK="$DIST/${PKG_NAME}_${PKG_VERSION}-${PKG_RELEASE}_${PKG_ARCH}.ipk"
( cd "$PKG_DIR" && ar rcs "$IPK" ./debian-binary ./control.tar.gz ./data.tar.gz )

ok "构建完成：$IPK"
printf "  大小：%s\n" "$(du -h "$IPK" | cut -f1)"
printf "  安装文件数：%s\n" "$(find "$DATA" -type f | wc -l)"

# ── 校验 ──────────────────────────────────────────────────────────────────
info "校验包结构"
if ar t "$IPK" | grep -q 'debian-binary' && ar t "$IPK" | grep -q 'control.tar.gz' && ar t "$IPK" | grep -q 'data.tar.gz'; then
	ok "包结构正确"
else
	err "包结构异常"
	exit 1
fi

cat <<EOF

安装方法（二选一）：

  1) 路由器联网安装：
       scp $IPK root@192.168.1.1:/tmp/
       ssh root@192.168.1.1 'opkg install /tmp/$(basename "$IPK")'
       # 或 apk: ssh root@192.168.1.1 'apk add --allow-untrusted /tmp/$(basename "$IPK")'

  2) 上传到 Web 界面：
       LuCI → 系统 → 软件包 → 上传软件包

卸载：
       opkg remove $PKG_NAME
       # 或 apk del $PKG_NAME

EOF
