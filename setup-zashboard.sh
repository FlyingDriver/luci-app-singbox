#!/bin/sh
# ============================================================================
# Zashboard 集成脚本（可选）
#
# Zashboard 是一个功能完整的 Clash API Web 面板。
# 本脚本把它与 sing-box 的 LuCI 插件打通：
#
#   SPA 静态文件 → http://<router>/zashboard/       （uhttpd:80，与 LuCI 同源）
#   Clash API    → http://<router>:8080/api/        （nginx 反代，服务端注入密钥）
#
# 用法：
#   sh setup-zashboard.sh              # 安装 / 更新
#   sh setup-zashboard.sh remove       # 移除
#
# 依赖：nginx（OpenWrt 通常已安装）、wget、ucode
# ============================================================================

set -e

ZB_DIR="/www/zashboard"
NGINX_CONF="/etc/nginx/conf.d/zashboard-api.conf"
API_PORT="8080"
API_PATH="/api"

CONF="/etc/sing-box/config.json"

C_G=''; C_Y=''; C_E=''; C_R=''
if [ -t 1 ]; then C_G='\033[32m'; C_Y='\033[33m'; C_E='\033[31m'; C_R='\033[0m'; fi
ok()   { printf "${C_G}✓${C_R} %s\n" "$*"; }
warn() { printf "${C_Y}⚠${C_R} %s\n" "$*"; }
err()  { printf "${C_E}✗${C_R} %s\n" "$*"; }

remove() {
	echo "→ 移除 Zashboard 集成"
	rm -rf "$ZB_DIR" "$NGINX_CONF"
	[ -f /etc/init.d/nginx ] && /etc/init.d/nginx reload >/dev/null 2>&1 || true
	ok "已移除（sing-box 配置未改动）"
	exit 0
}

[ "$1" = "remove" ] && remove

# ── 检查依赖 ──────────────────────────────────────────────────────────────
command -v nginx >/dev/null 2>&1 || { err "缺少 nginx，请先安装：opkg install nginx"; exit 1; }
[ -f "$CONF" ] || { err "未找到 $CONF"; exit 1; }

# ── 1. 下载 Zashboard ────────────────────────────────────────────────────
if [ -f "$ZB_DIR/index.html" ] && [ "$1" != "--force" ]; then
	warn "Zashboard 已存在，跳过下载（强制重装：sh setup-zashboard.sh --force）"
else
	echo "→ 下载 Zashboard 最新版…"
	TMP="/tmp/zashboard-dl.tar.gz"
	URL="https://github.com/Zephyruso/zashboard/releases/latest/download/dist-no-fonts.zip"

	if ! wget -q -O "$TMP" "$URL" 2>/dev/null; then
		err "下载失败，请检查网络或手动下载："
		echo "   $URL"
		echo "   解压到：$ZB_DIR"
		exit 1
	fi

	rm -rf "$ZB_DIR"; mkdir -p "$ZB_DIR"
	# OpenWrt 通常无 unzip，用 busybox unzip 或 python 兜底
	if command -v unzip >/dev/null 2>&1; then
		unzip -q -o "$TMP" -d "$ZB_DIR"
	elif busybox unzip -h >/dev/null 2>&1; then
		busybox unzip -q -o "$TMP" -d "$ZB_DIR"
	else
		err "缺少 unzip：opkg install unzip"
		exit 1
	fi
	rm -f "$TMP"

	# 兼容压缩包内有子目录的情况
	if [ ! -f "$ZB_DIR/index.html" ]; then
		SUB=$(find "$ZB_DIR" -maxdepth 2 -name index.html | head -1)
		[ -n "$SUB" ] && mv "$(dirname "$SUB")"/* "$ZB_DIR"/ 2>/dev/null || true
	fi

	# 清理大文件（emoji 字体 / 地球动画贴图），可省 ~2.7 MB
	rm -f "$ZB_DIR/assets/NotoColorEmoji"*.ttf \
	      "$ZB_DIR/assets/TwemojiMozilla"*.woff2 \
	      "$ZB_DIR/assets/earth-renderer"*.js \
	      "$ZB_DIR/assets/earth-surface"*.webp \
	      "$ZB_DIR/assets/earth-day"*.webp \
	      "$ZB_DIR/assets/earth-night"*.webp \
	      "$ZB_DIR/assets/background"*.jpg 2>/dev/null || true

	ok "Zashboard 已安装到 $ZB_DIR（$(du -sh "$ZB_DIR" | cut -f1)）"
fi

# ── 2. 生成 nginx 反代配置 ────────────────────────────────────────────────
echo "→ 生成 nginx 配置…"
mkdir -p /etc/nginx/conf.d

ucode -e "
import { readfile, writefile } from 'fs';

let cfg = json(readfile('$CONF'));
let api = cfg?.experimental?.clash_api;
let secret = api?.secret ?? '';

/* 安全性：secret 会被插入 nginx 配置的内层双引号中。
 * 若含双引号、右花括号或换行，会破坏 nginx 配置甚至注入指令。
 * 做一次白名单校验，不合规则不注入。 */
if (length(secret) && !match(secret, /^[A-Za-z0-9._~!@#$%^&*+=:?,-]+$/)) {
    printf('  [警告] Clash API secret 含 nginx 不安全字符，跳过密钥注入\\n');
    secret = '';
}
let ctl = api?.external_controller ?? '127.0.0.1:9090';
let idx = rindex(ctl, ':');
let upHost = idx > 0 ? substr(ctl, 0, idx) : '127.0.0.1';
let upPort = idx > 0 ? substr(ctl, idx + 1) : ctl;
if (upHost === '0.0.0.0' || length(upHost) === 0) upHost = '127.0.0.1';

let conf = \`# Zashboard Clash API 反向代理（自动生成，勿手改）
#
# 静态文件由 uhttpd 在 80 端口提供（与 LuCI 同源，便于 iframe 内嵌）
# 本 server 只代理 API，并注入 Authorization，密钥不暴露给浏览器。

map \\\$http_upgrade \\\$zb_connection {
	default upgrade;
	\"\"      close;
}

server {
	listen \${'$API_PORT'};
	listen [::]:\${'$API_PORT'};
	server_name _zashboard_api;
	access_log off;

	# ★ CORS 必须加。
	#   LuCI 在 :80（uhttpd），本 API 在 :${'$'}{API_PORT}（nginx），属跨源。
	#   sing-box 自带的 ACAO: * 已被上面 proxy_hide_header 剥掉，
	#   若不在这里回写，浏览器会拦掉所有 fetch，表现为「zashboard 后端连不上」。
	add_header Access-Control-Allow-Origin   "*" always;
	add_header Access-Control-Allow-Methods  "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
	add_header Access-Control-Allow-Headers  "Authorization, Content-Type" always;
	add_header Access-Control-Max-Age        3600 always;

	# 预检请求直接放行（不能放在 server 级 if，会影响 WebSocket 升级）

	# 支持 /api/xxx（剥前缀）与 /xxx（直通）两种访问方式
	location \${'$API_PATH'}/ {
		proxy_pass http://\${upHost}:\${upPort}/;
		proxy_http_version 1.1;
		proxy_set_header Host            \${upHost}:\${upPort};
		proxy_set_header Authorization   \"Bearer \${secret}\";
		proxy_set_header Upgrade         \\\$http_upgrade;
		proxy_set_header Connection      \\\$zb_connection;
		# 剥离 sing-box 自带的 Access-Control-Allow-Origin: *
		# （与下方 add_header 重复会导致浏览器拒绝），然后由 server 级 add_header 统一回。
		proxy_hide_header Access-Control-Allow-Origin;
		proxy_read_timeout 3600s;
		proxy_send_timeout 3600s;
		proxy_buffering off;
		proxy_cache off;
	}

	location / {
		proxy_pass http://\${upHost}:\${upPort};
		proxy_http_version 1.1;
		proxy_set_header Host            \${upHost}:\${upPort};
		proxy_set_header Authorization   \"Bearer \${secret}\";
		proxy_set_header Upgrade         \\\$http_upgrade;
		proxy_set_header Connection      \\\$zb_connection;
		# 剥离 sing-box 自带的 Access-Control-Allow-Origin: *
		# （与下方 add_header 重复会导致浏览器拒绝），然后由 server 级 add_header 统一回。
		proxy_hide_header Access-Control-Allow-Origin;
		proxy_read_timeout 3600s;
		proxy_send_timeout 3600s;
		proxy_buffering off;
		proxy_cache off;
	}
}
\`;
writefile('$NGINX_CONF', conf);
printf('  上游：%s:%s\\n', upHost, upPort);
printf('  密钥：%s\\n', length(secret) ? '已注入' : '无');
" || { err "nginx 配置生成失败"; exit 1; }

# ── 3. 校验并重载 nginx ──────────────────────────────────────────────────
NGX_MAIN="/etc/nginx/uci.conf"
[ -f "$NGX_MAIN" ] || NGX_MAIN="/etc/nginx/nginx.conf"

if nginx -t -c "$NGX_MAIN" >/dev/null 2>&1; then
	/etc/init.d/nginx reload >/dev/null 2>&1 || /etc/init.d/nginx restart >/dev/null 2>&1 || true
	ok "nginx 已重载"
else
	err "nginx 配置校验失败："
	nginx -t -c "$NGX_MAIN" 2>&1 | head -5
	exit 1
fi

# ── 4. 自检 ──────────────────────────────────────────────────────────────
echo "→ 自检…"
sleep 1

if wget -qO- -T 5 "http://127.0.0.1:$API_PORT$API_PATH/version" 2>/dev/null | grep -q version; then
	ok "API 代理正常"
else
	warn "API 代理未响应，请检查：logread | grep nginx"
fi

if [ -f "$ZB_DIR/index.html" ]; then
	ok "静态文件正常"
else
	warn "静态文件缺失"
fi

cat <<EOF

================================================================================
 Zashboard 集成完成

 独立访问：  http://<路由器IP>/zashboard/
 在 LuCI 中： LuCI → 服务 → sing-box → Zashboard（已内嵌）

 后端配置（如需手动填写）：
   协议    HTTP
   主机    <路由器IP>
   端口    $API_PORT
   二级路径 $API_PATH
   密码    留空（已由 nginx 服务端注入）

 说明：
   · 静态文件走 80 端口（与 LuCI 同源），iframe 内嵌无限制
   · API 走 $API_PORT，Authorization 由 nginx 注入，浏览器不持有密钥
   · 已自动裁剪 emoji 字体与地球动画资源，节省约 2.7 MB
================================================================================
EOF
