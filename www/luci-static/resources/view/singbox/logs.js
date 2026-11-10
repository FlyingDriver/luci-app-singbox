'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require singbox.sbcommon as sb';

/*
 * sing-box 日志页
 *
 * 数据来源：后端 luci.singbox.logs_read（logread 过滤 sing-box）
 * 交互：自动刷新开关 / 行数选择 / 级别过滤 / 一键复制
 */

const LINE_OPTIONS = [ 60, 120, 250, 500 ];

return view.extend({

	load: function() {
		/* 注意：rpcd 的 integer 参数必须用字符串传递，传真数字会 Invalid argument */
		return sb.callLogsRead('120').catch(() => null);
	},

	render: function(data) {
		sb.ensureCss();

		const initial = data || { ok: false, content: '' };

		let lines = 120;
		let autoRefresh = true;
		let levelFilter = 'all';
		let rawText = '';

		const elLog = E('pre', { class: 'sb-log', tabindex: '0', 'aria-label': _('sing-box log output') });
		const elMeta = E('span', { class: 'sb-dim sb-fs12' });

		/*
		 * 预期内的 ERROR 分类
		 *
		 * sing-box 在 log.level = warn 时，仍会把「REJECT 拦截」和
		 * 「DNS/连接失败」记为 ERROR。这些大多是**正常工作**，不是故障：
		 *
		 *   1. 广告/追踪域名被 🛑 全球拦截 命中 → 说明拦截规则生效了
		 *   2. ipv6.msftncsi.com 等 IPv6 探测失败 → 本机无 IPv6 出网，属环境限制
		 *   3. 客户端主动断连 → 用户关闭网页/App
		 *
		 * 这里把它们标为「预期」，与真正的故障区分开，避免日志噪音掩盖真问题。
		 */
		const EXPECTED = [
			{ re: /using outbound\/block\[REJECT\]/, why: _('广告拦截生效') },
			{ re: /ipv6\.msftncsi\.com/,              why: _('无 IPv6 出网') },
			{ re: /network is unreachable/,            why: _('目标网段不可达') },
			{ re: /connection (download|upload) closed/, why: _('连接被对端关闭') },
			{ re: /context canceled/,                  why: _('客户端主动取消') },
			{ re: /operation not permitted/,           why: _('被规则拒绝') }
		];

		/* 判断一条日志是否为预期内错误，返回原因字符串或 null */
		const classify = (line) => {
			if (!/ERROR/i.test(line))
				return null;
			for (const e of EXPECTED)
				if (e.re.test(line))
					return e.why;
			return null;
		};

		/* 按级别高亮（不用 innerHTML，避免 XSS） */
		const renderLog = () => {
			dom.content(elLog, []);

			if (!rawText || !rawText.trim().length) {
				elLog.appendChild(E('span', { class: 'sb-dim' }, [ _('暂无日志') ]));
				return;
			}

			/* sing-box 输出带 ANSI 颜色码，浏览器里会显示成 [31m 乱码，先剥离 */
			const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

			const all = rawText.split('\n').map(stripAnsi).filter((l) => l.length);

			const filtered = all.filter((l) => {
				if (levelFilter === 'all') return true;
				if (levelFilter === 'error') return /ERROR/i.test(l);
				if (levelFilter === 'warn') return /WARN|ERROR/i.test(l);
				return true;
			});

			let expectedCount = 0;
			let realErrCount = 0;

			filtered.forEach((line, i) => {
				const expected = classify(line);
				let cls = '';
				if (expected) { cls = 'sb-log-line--expected'; expectedCount++; }
				else if (/ERROR/i.test(line)) { cls = 'sb-log-line--err'; realErrCount++; }
				else if (/WARN/i.test(line)) cls = 'sb-log-line--warn';

				elLog.appendChild(E('span', { class: cls }, [ line ]));
				if (expected)
					elLog.appendChild(E('span', { class: 'sb-log-tag' }, [ ' ' + expected ]));
				if (i < filtered.length - 1) elLog.appendChild(document.createTextNode('\n'));
			});

			let metaTxt = `${filtered.length} / ${all.length} ` + _('行');
			/* ★ 真实错误数必须始终可见。
			 *   否则把拦截/环境类 ERROR 降级成"预期内"后，一眼看去日志很干净，
			 *   排障时会误判"没问题"。 */
			if (realErrCount > 0)
				metaTxt += ' · ' + _('%d 条真实错误').format(realErrCount);
			if (expectedCount > 0)
				metaTxt += ' · ' + _('%d 条为预期内').format(expectedCount);
			dom.content(elMeta, [ metaTxt ]);
		};

		const fetchLogs = (scrollBottom) => {
			return sb.callLogsRead(String(lines)).then((r) => {
				if (r && r.ok) {
					const atBottom = (elLog.scrollTop + elLog.clientHeight) >= (elLog.scrollHeight - 40);
					rawText = r.content || '';
					renderLog();
					if (scrollBottom || atBottom)
						elLog.scrollTop = elLog.scrollHeight;
				}
			});
		};

		/* 首次渲染 */
		rawText = initial.content || '';
		renderLog();
		window.setTimeout(() => { elLog.scrollTop = elLog.scrollHeight; }, 50);

		/* 自动刷新 */
		poll.add(() => {
			if (!autoRefresh) return Promise.resolve();
			return fetchLogs(true);
		}, 5);

		/* 工具栏 */
		const toolbar = E('div', { class: 'sb-row-gap' }, [
			/* 自动刷新开关 */
			E('label', { class: 'sb-row-gap sb-fs12', style: 'cursor: pointer;' }, [
				E('input', {
					type: 'checkbox', checked: 'checked',
					change: (ev) => { autoRefresh = ev.target.checked; }
				}),
				_('自动刷新')
			]),

			/* 行数 */
			E('select', {
				class: 'sb-select', style: 'width: auto;',
				change: (ev) => { lines = parseInt(ev.target.value, 10) || 120; fetchLogs(true); }
			}, LINE_OPTIONS.map((n) =>
				E('option', { value: n, selected: n === 120 ? '' : null }, [ `${n} ` + _('行') ])
			)),

			/* 级别过滤 */
			sb.segmented([
				{ value: 'all',   label: _('全部') },
				{ value: 'warn',  label: 'WARN+' },
				{ value: 'error', label: 'ERROR' }
			], 'all', (v) => { levelFilter = v; renderLog(); }),

			/* 手动刷新 */
			sb.button(_('刷新'), {
				small: true, icon: 'refresh',
				click: () => fetchLogs(true).then(() => sb.toast(_('已刷新'), 'ok'))
			}),

			/* 复制 */
			sb.button(_('复制'), {
				small: true, icon: 'file_text',
				click: () => {
					/* ★ 用 rawText 而不是 elLog.textContent：
					 *   渲染时给预期内日志追加了" 广告拦截生效"等标签文本，
					 *   直接复制 textContent 会把标签混进日志里，粘到 issue 上就是脏数据。 */
					const text = rawText || '';
					if (navigator.clipboard && navigator.clipboard.writeText) {
						return navigator.clipboard.writeText(text).then(() => sb.toast(_('已复制到剪贴板'), 'ok'));
					}
					sb.toast(_('浏览器不支持剪贴板 API'), 'warn');
				}
			}),

			elMeta
		]);

		return E('div', { class: 'sb-wrap' }, [
			sb.card(_('Logs'), 'file_text', [ elLog ], [ toolbar ]),
			sb.alertBox(
				_('日志来自系统日志（logread）中的 sing-box 条目。如需更详细输出，可在配置文件 log.level 调整为 debug（会增加写入量）。'),
				null
			)
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
