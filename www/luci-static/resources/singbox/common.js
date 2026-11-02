'use strict';
'require baseclass';
'require rpc';
'require dom';
'require ui';

/*
 * sing-box 插件共享模块
 *
 * 约定：
 *   - 所有 Clash API 访问经后端 luci.singbox.clash_get 代理，前端不接触 secret
 *   - 图标使用内联 SVG（禁止 emoji，符合 ui-ux-pro-max 可访问性要求）
 *   - 数字使用 tabular-nums，速率/字节统一格式化
 */

/* ───────────── RPC 声明 ───────────── */

const callStatus      = rpc.declare({ object: 'luci.singbox', method: 'status' });
const callClashGet    = rpc.declare({ object: 'luci.singbox', method: 'clash_get', params: [ 'path' ] });
const callSetMode     = rpc.declare({ object: 'luci.singbox', method: 'set_mode', params: [ 'mode' ] });
const callSelectNode  = rpc.declare({ object: 'luci.singbox', method: 'select_node', params: [ 'group', 'name' ] });
const callTestNode    = rpc.declare({ object: 'luci.singbox', method: 'test_node', params: [ 'name' ] });
const callNodesList   = rpc.declare({ object: 'luci.singbox', method: 'nodes_list' });
const callNodeSave    = rpc.declare({ object: 'luci.singbox', method: 'node_save', params: [ 'node', 'original_tag' ] });
const callNodeDelete  = rpc.declare({ object: 'luci.singbox', method: 'node_delete', params: [ 'tag' ] });
const callRulesList   = rpc.declare({ object: 'luci.singbox', method: 'rules_list' });
const callRulesSave   = rpc.declare({ object: 'luci.singbox', method: 'rules_save', params: [ 'rules' ] });
const callRulesMerge   = rpc.declare({ object: 'luci.singbox', method: 'rules_merge' });
const callRulesetList  = rpc.declare({ object: 'luci.singbox', method: 'ruleset_list' });
const callRulesetRead  = rpc.declare({ object: 'luci.singbox', method: 'ruleset_read', params: [ 'tag' ] });
const callRulesetSave  = rpc.declare({ object: 'luci.singbox', method: 'ruleset_save', params: [ 'tag', 'items' ] });
const callService     = rpc.declare({ object: 'luci.singbox', method: 'service', params: [ 'action' ] });
const callLogsRead    = rpc.declare({ object: 'luci.singbox', method: 'logs_read', params: [ 'lines' ] });
const callRunStats    = rpc.declare({ object: 'luci.singbox', method: 'run_stats' });
const callIpInfo      = rpc.declare({ object: 'luci.singbox', method: 'ip_check' });
const callTmpStats    = rpc.declare({ object: 'luci.singbox', method: 'tmp_stats' });
const callTmpCleanup  = rpc.declare({ object: 'luci.singbox', method: 'tmp_cleanup', params: [ 'scope' ] });
const callAccessCheck = rpc.declare({ object: 'luci.singbox', method: 'access_check' });
const callFlushDns    = rpc.declare({ object: 'luci.singbox', method: 'flush_dns' });
const callCloseConns  = rpc.declare({ object: 'luci.singbox', method: 'close_connections' });

/* ───────────── 图标（Lucide 风格内联 SVG） ───────────── */

const ICON_PATHS = {
	activity:   [ 'M22 12h-4l-3 9L9 3l-3 9H2' ],
	server:     [ 'M2 2h20v8H2z', 'M2 14h20v8H2z', 'M6 6h.01', 'M6 18h.01' ],
	arrow_down: [ 'M12 5v14', 'M19 12l-7 7-7-7' ],
	arrow_up:   [ 'M12 19V5', 'M5 12l7-7 7 7' ],
	route:      [ 'M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M9 16h6a3 3 0 0 0 0-6h-1' ],
	file_text:  [ 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5' ],
	power:      [ 'M18.36 6.64a9 9 0 1 1-12.73 0', 'M12 2v10' ],
	refresh:    [ 'M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M1 14l4.64 4.36A9 9 0 0 0 20.49 15' ],
	zap:        [ 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' ],
	trash:      [ 'M3 6h18', 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6', 'M10 11v6', 'M14 11v6', 'M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' ],
	plus:       [ 'M12 5v14', 'M5 12h14' ],
	pencil:     [ 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' ],
	check:      [ 'M20 6L9 17l-5-5' ],
	x:          [ 'M18 6L6 18', 'M6 6l12 12' ],
	info:       [ 'M12 16v-4', 'M12 8h.01', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' ],
	alert:      [ 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z', 'M12 9v4', 'M12 17h.01' ],
	clock:      [ 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2' ],
	inbox:      [ 'M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' ]
};

function icon(name, size, extraClass) {
	const paths = ICON_PATHS[name] || ICON_PATHS.info;
	const s = size || 16;

	/* 注意：LuCI 的 E() 只接受扁平 children，嵌套数组会被 String() 化，
	 * 必须用 spread 展开，否则 SVG path 不会渲染（表现为按钮空白）。 */
	const children = [];

	paths.forEach(function(d) {
		children.push(E('path', { d: d }));
	});

	/* 必须用 inline style 强制尺寸：LuCI 主题的 svg 规则会把 width/height 属性覆盖掉，
	 * 导致 SVG 渲染为 0 宽（表现为按钮只剩空方块）。 */
	return E('svg', {
		xmlns: 'http://www.w3.org/2000/svg',
		width: s, height: s, viewBox: '0 0 24 24',
		fill: 'none', stroke: 'currentColor',
		'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
		'aria-hidden': 'true',
		class: extraClass || '',
		style: 'width:' + s + 'px !important;height:' + s + 'px !important;' +
		       'min-width:' + s + 'px;min-height:' + s + 'px;' +
		       'display:block;flex:0 0 auto;vertical-align:middle;'
	}, children);
}

/* ───────────── 格式化 ───────────── */

function fmtBytes(n) {
	n = Number(n) || 0;
	if (n < 1024) return `${n} B`;
	const u = [ 'KB', 'MB', 'GB', 'TB' ];
	let i = -1;
	do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
	return `${n.toFixed(n >= 100 ? 0 : 1)} ${u[i]}`;
}

function fmtRate(bps) {
	return `${fmtBytes(bps)}/s`;
}


/* 延迟 → 徽章等级 */
function delayLevel(ms) {
	if (ms == null || ms <= 0) return 'idle';
	if (ms < 150) return 'ok';
	if (ms < 400) return 'warn';
	return 'err';
}

function badge(text, level, withDot) {
	return E('span', { class: `sb-badge${level ? ` sb-badge--${level}` : ''}` }, [
		withDot ? E('span', { class: `sb-dot sb-dot--${level || 'idle'}` }) : '',
		text
	]);
}

/* ───────────── 通用组件 ───────────── */

function card(title, iconName, children, actions) {
	/* 注意：LuCI 的 E() 只接受扁平 children，
	 * 嵌套数组会被 String() 成 "[object HTMLDivElement]"，必须展开。 */
	const head = [];

	if (title || actions) {
		head.push(E('h3', { class: 'sb-card-title' }, [
			iconName ? icon(iconName, 14) : '',
			title || ''
		]));

		if (actions) {
			const items = Array.isArray(actions) ? actions : [ actions ];
			items.forEach((it) => { if (it) head.push(it); });
		}
	}

	return E('div', { class: 'sb-card' }, [
		head.length ? E('div', { class: 'sb-card-head' }, head) : '',
		...(Array.isArray(children) ? children : [ children ])
	]);
}


function emptyState(text) {
	return E('div', { class: 'sb-empty' }, [
		icon('inbox', 30),
		E('div', {}, [ text ])
	]);
}

function alertBox(text, level) {
	const iconName = level === 'err' ? 'alert' : (level === 'warn' ? 'alert' : (level === 'ok' ? 'check' : 'info'));
	return E('div', { class: `sb-alert${level ? ` sb-alert--${level}` : ''}` }, [
		icon(iconName, 16),
		E('div', { class: 'sb-grow' }, [ text ])
	]);
}

/* 按钮（带 loading 态） */
function button(label, opts) {
	const o = opts || {};
	const btn = E('button', {
		class: `sb-btn${o.primary ? ' sb-btn--primary' : ''}${o.small ? ' sb-btn--sm' : ''}${o.danger ? ' sb-btn--danger' : ''}`,
		type: 'button',
		disabled: o.disabled ? '' : null,
		style: o.style || null,
		title: o.title || null,
		'aria-label': o.ariaLabel || o.title || null,
		click: function(ev) {
			ev.preventDefault();
			if (btn.disabled) return;
			btn.disabled = true;
			const old = btn.innerHTML;
			btn.innerHTML = '';
			btn.appendChild(E('span', { class: 'sb-loading' }));
			if (o.label !== undefined) btn.appendChild(document.createTextNode(' ' + o.label));

			Promise.resolve()
				.then(() => o.click && o.click(ev))
				.catch((e) => { ui.addNotification(null, E('p', {}, [ String(e) ]), 'danger'); })
				.finally(() => {
					btn.disabled = false;
					btn.innerHTML = old;
				});
		}
	}, (function() {
		const kids = [];
		if (o.icon) kids.push(icon(o.icon, o.small ? 13 : 15));
		if (label && label.length) kids.push(document.createTextNode(label));
		/* 纯图标按钮：确保有最小可点击区域 */
		if (!kids.length) kids.push(document.createTextNode('\u00a0'));
		return kids;
	})());

	btn.setAttribute('title', o.title || o.ariaLabel || label || '');
	btn.setAttribute('aria-label', o.ariaLabel || o.title || label || 'button');

	return btn;
}

/* 分段控件 */
function segmented(options, current, onSelect) {
	const wrap = E('div', { class: 'sb-seg', role: 'group' });

	options.forEach((opt) => {
		const isActive = (opt.value === current);
		wrap.appendChild(E('button', {
			type: 'button',
			class: `sb-seg-item${isActive ? ' is-active' : ''}`,
			'aria-pressed': isActive ? 'true' : 'false',
			click: function(ev) {
				ev.preventDefault();
				/* ★ 必须查 DOM 实时状态，不能用闭包里的 isActive 快照：
				 * 否则第一次切换后，原选中项的 isActive 仍为 true，
				 * 再点回它就会被 `if (isActive) return` 拦掉（"切不回规则模式"的根因）。 */
				const self = ev.currentTarget;
				if (self.classList.contains('is-active')) return;

				wrap.querySelectorAll('.sb-seg-item').forEach((b) => {
					b.classList.remove('is-active');
					b.setAttribute('aria-pressed', 'false');
				});
				self.classList.add('is-active');
				self.setAttribute('aria-pressed', 'true');
				onSelect(opt.value);
			}
		}, [ opt.label ]));
	});

	return wrap;
}

/* 注入样式表（一次） */
let cssInjected = false;
function ensureCss() {
	if (cssInjected) return;
	cssInjected = true;
	document.head.appendChild(E('link', {
		rel: 'stylesheet',
		href: L.resource('singbox.css')
	}));
}

/* 轻量 toast（成功后自动消失） */
function toast(message, level) {
	const el = E('div', {
		class: `sb-alert${level ? ` sb-alert--${level}` : ' sb-alert--ok'}`,
		style: 'position: fixed; right: 18px; bottom: 18px; z-index: 9999; max-width: 340px;' +
		       'box-shadow: 0 6px 24px rgba(0,0,0,0.18);'
	}, [ icon(level === 'err' ? 'alert' : 'check', 16), E('div', {}, [ message ]) ]);

	document.body.appendChild(el);
	setTimeout(() => el.remove(), 2600);
}

return baseclass.extend({
	/* RPC */
	callStatus, callClashGet, callSetMode, callSelectNode, callTestNode,
	callNodesList, callNodeSave, callNodeDelete,
	callRulesList, callRulesSave, callRulesMerge, callRulesetList, callRulesetRead, callRulesetSave, callService, callLogsRead,
	callRunStats, callIpInfo, callAccessCheck, callFlushDns, callCloseConns, callTmpStats, callTmpCleanup,

	/* 图标与格式化 */
	icon, fmtBytes, fmtRate, delayLevel, badge,

	/* 组件 */
	card, emptyState, alertBox, button, segmented,
	ensureCss, toast
});
