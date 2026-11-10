'use strict';
'require view';
'require dom';
'require singbox.sbcommon as sb';

/*
 * Zashboard 内嵌页
 *
 * ── 架构 ──────────────────────────────────────────────────────────────────
 *   静态 SPA  →  http://<host>/zashboard/       (uhttpd:80，与 LuCI 同源)
 *   Clash API →  http://<host>:8080/api/        (nginx 注入 secret + CORS)
 *
 * ── 两个必须遵守的约束 ────────────────────────────────────────────────────
 *
 * 1. **iframe 的 src 绝对不能带查询参数**
 *
 *    zashboard 用 hash 路由（#/proxies）。如果不带查询参数访问，
 *    它生成的导航链接是纯 hash（href="#/connections"），点击走 hash 变化，
 *    iframe 不会重新加载。
 *
 *    但一旦访问 URL 带了查询参数，zashboard 的链接生成逻辑会把整个
 *    URL（含查询串）作为 href 前缀，变成：
 *        href="/zashboard/?hostname=x&port=8080#/connections"
 *    点击时浏览器认为这是"同文档不同查询串"→ 触发完整导航 → 整页刷新 →
 *    白屏重载 2.1MB JS + 重建 WebSocket。这就是"加载慢 + 整页刷新"的根因。
 *
 *    所以：后端配置只通过 localStorage 注入，URL 保持干净。
 *
 * 2. **localStorage 的键名和结构必须精确匹配 zashboard 的期望**
 *
 *      setup/api-list     后端数组
 *      setup/active-uuid  当前选中的后端 uuid
 *
 *    zashboard 只在"没有任何存储配置"时才读 URL 参数。一旦用户
 *    存过错误配置（例如调试期的 9091、或 127.0.0.1:9090），该错误会
 *    永久驻留 → "后端连不上"。因此每次渲染都强制重写这两个键。
 */

const ZB_PORT = '8080';   /* nginx 注入 secret 的 Clash API 端口 */
const ZB_PATH = '/api';   /* nginx 里 proxy_pass 到 9090 的前缀 */

/* 基于 host 生成稳定 uuid（同一路由器不变，避免每次渲染都换后端） */
function makeUuid(seed) {
	let h = 5381;
	for (let i = 0; i < seed.length; i++)
		h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
	const s = h.toString(16).padStart(8, '0');
	return s + '-0000-4000-8000-' + s.padStart(12, '0').slice(0, 12);
}

/* 把正确的后端配置写入 localStorage（zashboard 读取它，而非 URL 参数） */
function primeBackend(host) {
	const uuid = makeUuid('singbox:' + host);
	const cfg = [{
		type: 'clash',
		protocol: 'http',
		host: host,
		port: ZB_PORT,
		secondaryPath: ZB_PATH,
		password: '',
		label: '',
		disableUpgradeCore: false,
		disableTunMode: false,
		uuid: uuid
	}];

	try {
		localStorage.setItem('setup/api-list', JSON.stringify(cfg));
		localStorage.setItem('setup/active-uuid', uuid);
	} catch (e) {
		/* 隐私模式下 localStorage 不可用；此时 zashboard 会用默认 127.0.0.1:9090，
		 * 连不上但不影响页面本身，属于可接受的降级。 */
	}

	return uuid;
}

return view.extend({

	render: function() {
		sb.ensureCss();

		const host = window.location.hostname;

		primeBackend(host);

		/* ★ 关键：src 必须干净，不带任何查询参数（原因见文件头注释 1） */
		const src = window.location.protocol + '//' + host + '/zashboard/';

		/* 加载遮罩：iframe 内部要解析 2.1MB JS 并建立 WebSocket，
		 * 这段时间是白屏。给个进度提示，避免用户以为卡死。 */
		const mask = E('div', {
			'class': 'sb-zb-mask',
			style: 'position:absolute;inset:0;display:flex;flex-direction:column;' +
				'align-items:center;justify-content:center;gap:14px;' +
				'background:var(--sb-bg,#0b1020);color:var(--sb-fg,#94a3b8);' +
				'font-size:14px;z-index:1;transition:opacity .25s ease'
		}, [
			E('div', {
				style: 'width:34px;height:34px;border:3px solid rgba(148,163,184,.25);' +
					'border-top-color:var(--sb-accent,#3b82f6);border-radius:50%;' +
					'animation:sb-zb-spin .8s linear infinite'
			}),
			E('div', {}, [ _('正在加载 Zashboard…') ]),
			E('div', {
				style: 'font-size:12px;opacity:.6;max-width:320px;text-align:center;line-height:1.6'
			}, [ _('首次加载需初始化面板，约 1-2 秒') ])
		]);

		const iframe = E('iframe', {
			src: src,
			title: 'Zashboard',
			style: 'width:100%;height:100%;border:0;display:block;background:#0b1020'
		});

		/* iframe 用 flex 撑满，不写死 calc（避免主题差异导致高度算错） */
		const wrap = E('div', {
			style: 'position:relative;width:100%;height:calc(100vh - 8.5rem);' +
				'min-height:520px;overflow:hidden;border-radius:8px;background:#0b1020'
		}, [ mask, iframe ]);

		/* iframe 加载完成后淡出遮罩 */
		iframe.addEventListener('load', function() {
			mask.style.opacity = '0';
			setTimeout(function() {
				if (mask.parentNode)
					mask.parentNode.removeChild(mask);
			}, 260);
		}, { once: true });

		/* 消除 LuCI 默认的 cbi-map 内边距，让 iframe 真正占满内容区 */
		requestAnimationFrame(function() {
			const map = document.querySelector('.cbi-map');
			if (!map)
				return;
			map.style.padding = '0';
			map.style.margin = '0';
			Array.prototype.forEach.call(map.children, function(ch) {
				if (ch.classList && ch.classList.contains('cbi-map-descr'))
					return;
				ch.style.padding = '0';
			});
		});

		return wrap;
	},

	/* 本页没有需要保存的表单 */
	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
