#!/bin/sh
# ============================================================================
# luci-app-singbox —— sing-box 的 LuCI 可视化管理插件
#
# 用法（在路由器上）：
#   sh install.sh              # 安装 / 升级
#   sh install.sh uninstall    # 卸载
#   sh install.sh check        # 环境检查
#
# 设计：
#   · 纯静态文件 + ucode 后端，无二进制、无编译、无额外运行时依赖
#   · 兼容 apk（ImmortalWrt / OpenWrt 24.10+）与 opkg（23.05 及更早）
#   · 不修改 sing-box 配置，除非用户在界面上主动保存
#   · 所有写操作先备份 + `sing-box check` 校验通过后才落盘
#   · 不硬编码 IP / 端口 / 密码，全部从 /etc/sing-box/config.json 动态读取
# ============================================================================

set -e

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"

ACL_DST="/usr/share/rpcd/acl.d/luci-app-singbox.json"
MENU_DST="/usr/share/luci/menu.d/luci-app-singbox.json"
UCODE_DST="/usr/share/rpcd/ucode/luci.singbox"
CSS_DST="/www/luci-static/resources/singbox.css"
JS_DIR="/www/luci-static/resources/singbox"
VIEW_DST="/www/luci-static/resources/view/singbox"
DOC_DIR="/usr/share/luci-app-singbox"
CONF="/etc/sing-box/config.json"

if [ -t 1 ]; then
	C_G='\033[32m'; C_Y='\033[33m'; C_E='\033[31m'; C_B='\033[36m'; C_0='\033[0m'
else
	C_G=''; C_Y=''; C_E=''; C_B=''; C_0=''
fi
ok()   { printf "${C_G}✓${C_0} %s\n" "$*"; }
warn() { printf "${C_Y}⚠${C_0} %s\n" "$*"; }
err()  { printf "${C_E}✗${C_0} %s\n" "$*"; }
info() { printf "${C_B}→${C_0} %s\n" "$*"; }

# ── 卸载 ─────────────────────────────────────────────────────────────────────
do_uninstall() {
	info "卸载 luci-app-singbox"

	rm -f  "$ACL_DST" "$MENU_DST" "$UCODE_DST" "$CSS_DST"
	rm -rf "$JS_DIR" "$VIEW_DST" "$DOC_DIR"

	# 清理运行期产生的临时文件（tmpfs，重启也会消失，这里立即释放）
	rm -f  /tmp/luci-indexcache*
	rm -f  /tmp/sb-rs-count-* /tmp/sb-rs-*.json /tmp/sb-probe-*.json
	rm -f  /tmp/sb-ipcache.json /tmp/sb-rate-prev.json
	rm -rf /tmp/singbox-luci.lock /tmp/sb-rs-save-*

	/etc/init.d/rpcd restart >/dev/null 2>&1 || true

	ok "已卸载"
	info "sing-box 本体、配置、规则集、cache.db 均未删除"
	exit 0
}

# ── 环境检查 ─────────────────────────────────────────────────────────────────
do_check() {
	fail=0
	info "环境检查"

	# 运行时依赖
	if [ -x /usr/bin/ucode ]; then
		ok "ucode 可用"
	else
		err "缺少 ucode（必需）"
		fail=1
	fi

	[ -d /www/luci-static/resources ] && ok "LuCI 资源目录存在" || { err "非 LuCI 环境"; fail=1; }

	# sing-box
	if [ -f "$CONF" ]; then
		ok "sing-box 配置：$CONF"
	else
		warn "未找到 $CONF（插件可安装，但功能需要 sing-box 配置）"
	fi

	if command -v sing-box >/dev/null 2>&1; then
		ok "sing-box：$(sing-box version 2>/dev/null | head -1)"
	else
		warn "未找到 sing-box 命令"
	fi

	# 包管理器
	if command -v apk >/dev/null 2>&1; then
		ok "包管理器：apk（$(apk --version 2>/dev/null | head -1)）"
	elif command -v opkg >/dev/null 2>&1; then
		ok "包管理器：opkg"
	else
		warn "未检测到包管理器"
	fi

	# Clash API（插件的唯一数据源）
	if [ -f "$CONF" ] && [ -x /usr/bin/ucode ]; then
		ucode -e '
			import { readfile } from "fs";
			let c = json(readfile("/etc/sing-box/config.json"));
			let a = c?.experimental?.clash_api;
			if (a) printf("  Clash API: %s (secret %s)\n",
				a.external_controller ?? "未设置",
				length(a.secret ?? "") ? "已设置" : "未设置");
			else printf("  ⚠ Clash API 未配置（插件无法工作）\n");
		' 2>/dev/null || true
	fi

	[ $fail -eq 0 ] && ok "检查通过" || err "检查未通过"
	exit $fail
}

case "${1:-install}" in
	uninstall|remove) do_uninstall ;;
	check)            do_check ;;
	install|"")       ;;
	*) err "未知参数：$1"; exit 1 ;;
esac

# ── 安装 ─────────────────────────────────────────────────────────────────────
info "安装 luci-app-singbox"

[ -x /usr/bin/ucode ] || { err "缺少 ucode（必需）"; exit 1; }
[ -f "$CONF" ]        || warn "未找到 $CONF"

mkdir -p /usr/share/rpcd/acl.d /usr/share/rpcd/ucode /usr/share/luci/menu.d
mkdir -p "$JS_DIR" "$VIEW_DST" "$DOC_DIR"

# 后端
cp -f "$PKG_DIR/usr/share/rpcd/ucode/luci.singbox"           "$UCODE_DST"
cp -f "$PKG_DIR/usr/share/rpcd/acl.d/luci-app-singbox.json"  "$ACL_DST"
cp -f "$PKG_DIR/usr/share/luci/menu.d/luci-app-singbox.json" "$MENU_DST"

# 前端
cp -f "$PKG_DIR/www/luci-static/resources/singbox.css"       "$CSS_DST"
cp -f "$PKG_DIR/www/luci-static/resources/singbox/common.js" "$JS_DIR/common.js"
cp -f "$PKG_DIR/www/luci-static/resources/view/singbox/"*.js "$VIEW_DST/"

# 附带工具与文档
cp -f "$PKG_DIR/setup-zashboard.sh" "$PKG_DIR/install.sh" "$DOC_DIR/" 2>/dev/null || true
cp -f "$PKG_DIR/README.md"          "$DOC_DIR/" 2>/dev/null || true

# 权限
chmod 755 "$UCODE_DST"
chmod 644 "$ACL_DST" "$MENU_DST" "$CSS_DST"
chmod 644 "$JS_DIR/common.js" "$VIEW_DST"/*.js

# 后端语法校验（失败即中止，避免装出一个"看起来能开但 RPC 全错"的插件）
if ! ucode -c "$UCODE_DST" >/dev/null 2>&1; then
	err "ucode 后端语法校验失败"
	ucode -c "$UCODE_DST" 2>&1 | head -5
	exit 1
fi
ok "后端语法校验通过"

# 生效
rm -f /tmp/luci-indexcache*
/etc/init.d/rpcd restart >/dev/null 2>&1 || true
sleep 2

if ubus list 2>/dev/null | grep -q '^luci\.singbox$'; then
	ok "后端已注册：luci.singbox"
else
	warn "后端未注册，排查：logread | grep rpcd"
fi

cat <<'EOF'

================================================================================
 安装完成

 访问：LuCI → 服务 → sing-box

   概览        服务控制 / 运行模式 / 实时速率 / 本地与代理 IP / 访问检查
   节点        节点与分组管理 / 延迟测速 / 一键切换 / 增删改
   路由        规则查看与编辑 / 搜索（含规则集内部）/ 合并 / 规则集明细编辑
   日志        实时日志（含自动错误分类）
   Zashboard   完整 Clash API 面板（需先运行 setup-zashboard.sh）

 环境检查：sh install.sh check
 卸载：    sh install.sh uninstall
================================================================================
EOF
