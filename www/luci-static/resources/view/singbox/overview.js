'use strict';
'require view';
'require poll';
'require dom';
'require ui';
'require singbox.sbcommon as sb';

/*
 * sing-box 总览页
 *
 * 布局（OpenClash 风格）：
 *   ┌ 运行状态（统一控制） │ 访问入口 │ 代理设置 ┐
 *   ├ 运行模式 │ 当前出站 │ 运行数据 ┤
 *   ├ IP 地址（本地 + 代理）        ┤
 *   ├ 访问检查（6 站点）            ┤
 *   └ 快捷操作                      ┘
 *
 * 设计原则：
 *   1. 服务控制统一为「状态徽章 + 单个开关 + 重启按钮」，不再重复出现停止按钮
 *   2. 所有危险操作二次确认
 *   3. Zashboard 在当前标签页内跳转，不新开窗口
 */

return view.extend({

	load: function() {
		return Promise.all([
			sb.callStatus().catch(() => null),
			sb.callClashGet('/proxies').catch(() => null),
			sb.callGlobalModeGet().catch(() => null)
		]);
	},

	render: function(data) {
		sb.ensureCss();
		const view = this;

		const status  = data[0] || {};
		const proxies = (data[1] && data[1].ok && data[1].data) ? data[1].data.proxies : {};
		/* 真正的全局覆盖状态（读 route.rules 里是否插了全捕获规则） */
		const gmode   = (data[2] && data[2].ok) ? data[2] : { mode: 'rule', outbound: null };

		const elStatusBadge = E('span');
		const elRunData     = E('div', { class: 'oc-rundata' });
		const elIpGrid      = E('div', { class: 'oc-grid2' });
		const elAccessGrid  = E('div', { class: 'oc-grid2' });
		const elModeSeg     = E('div');
		const elProxySeg    = E('div');
		const elSvcBtns     = E('div', { class: 'oc-btn-row' });

		/* ── 状态徽章 ── */
		const renderStatus = (running, enabled) => {
			dom.content(elStatusBadge, [
				E('span', { class: 'oc-status ' + (running ? 'oc-status--on' : 'oc-status--off') },
					[ running ? _('运行中') : _('已停止') ])
			]);
		};
		renderStatus(status.running);

		/* ── 统一的按钮组（只渲染一次，避免重复） ── */
		const renderSvcButtons = (running) => {
			const btns = [];

			if (running) {
				btns.push(E('button', {
					class: 'oc-quick-btn', type: 'button',
					click: function(ev) {
						if (!confirm(_('确认重启 sing-box？重启期间代理会中断约 8 秒。'))) return;
						const b = ev.currentTarget;
						b.disabled = true; b.textContent = _('重启中…');
						sb.callService('restart').then(function(r) {
							if (r && r.ok) {
								sb.toast(_('已重启'), 'ok');
								window.setTimeout(function() { location.reload(); }, 9000);
							} else {
								b.disabled = false; b.textContent = _('重启');
								sb.toast((r && r.error) || _('重启失败'), 'err');
							}
						});
					}
				}, [ _('重启服务') ]));
			} else {
				btns.push(E('button', {
					class: 'oc-quick-btn', type: 'button',
					click: function(ev) {
						const b = ev.currentTarget;
						b.disabled = true; b.textContent = _('启动中…');
						sb.callService('start').then(function(r) {
							if (r && r.ok) {
								sb.toast(_('已启动'), 'ok');
								window.setTimeout(function() { location.reload(); }, 6000);
							} else {
								b.disabled = false; b.textContent = _('启动服务');
								sb.toast((r && r.error) || _('启动失败'), 'err');
							}
						});
					}
				}, [ _('启动服务') ]));
			}

			dom.content(elSvcBtns, btns);
		};
		renderSvcButtons(status.running);

		/* ── 服务开关 ── */
		const svcSwitch = E('label', { class: 'oc-switch' }, [
			E('input', {
				type: 'checkbox',
				checked: status.running ? 'checked' : null,
				change: function(ev) {
					const on = ev.target.checked;

					if (!on && !confirm(_('确认停止 sing-box？停止后所有代理流量将中断，仅剩直连。'))) {
						ev.target.checked = true;
						return;
					}

					sb.callService(on ? 'start' : 'stop').then(function(r) {
						if (r && r.ok) {
							sb.toast(on ? _('服务已启动') : _('服务已停止'), on ? 'ok' : 'warn');
							window.setTimeout(function() { location.reload(); }, on ? 6000 : 2500);
						} else {
							sb.toast((r && r.error) || _('操作失败'), 'err');
							ev.target.checked = !on;
						}
					});
				}
			}),
			E('span', { class: 'oc-switch-track' }, [ E('span', { class: 'oc-switch-thumb' }) ]),
			E('span', { class: 'oc-switch-label' }, [ status.running ? _('已启用') : _('已禁用') ])
		]);

		/* ══════════════════════════════════════════════════════════════════
		 * 运行模式（真·全局覆盖，等价于 Clash 的 mode: rule / global / direct）
		 *
		 * 【为什么不是 Clash 的 mode】
		 *   sing-box 的 Clash API 里 mode-list 只有 ["rule"]，
		 *   PATCH /configs {"mode":"global"} 返回 204 但读回仍是 rule
		 *   （内核直接丢弃）→ 配置里的 clash_mode 规则永远不会命中。
		 *
		 * 【本实现】
		 *   往 route.rules 最前面（hijack-dns 之后）插入一条无条件的
		 *   {"outbound":"<目标组>"}，所有流量都被它捕获，后面的 13 条
		 *   分流规则不再执行 = 真正的全局覆盖。
		 *   切回「规则」时把这条规则移除，完全还原。
		 *
		 * 【代价】
		 *   保存配置 + 重启 sing-box，约 1-2 秒断流。
		 * ══════════════════════════════════════════════════════════════════ */

		const G = {
			fallback: '🐟 漏网之鱼',
			direct:   '🎯 全球直连',
			proxy:    '🔰 节点选择',
			auto:     '♻️ 自动选择'
		};

		const fbGroup = proxies[G.fallback];
		const currentTarget = (fbGroup && fbGroup.now) || '';

		const MODE_LABEL = {
			rule:   _('规则分流'),
			global: _('全局代理'),
			direct: _('全部直连')
		};

		/* 渲染当前模式说明 */
		const renderModeInfo = function(mode, outbound) {
			const isOverride = (mode === 'global' || mode === 'direct' || mode === 'custom');
			const desc = isOverride
				? _('所有流量强制走「%s」，分流规则暂不生效').format(outbound || MODE_LABEL[mode])
				: _('按 13 条分流规则处理；未匹配的流量走兜底（%s）').format(currentTarget || G.fallback);

			dom.content(elProxySeg, [
				E('div', { class: 'oc-inline' }, [
					E('span', { class: 'oc-muted' }, [ isOverride ? _('全局覆盖 →') : _('兜底出站 →') ]),
					E('strong', {}, [ isOverride ? (outbound || '—') : (currentTarget || '—') ])
				]),
				E('div', { class: 'sb-hint', style: 'margin-top: 6px;' }, [ desc ]),
				isOverride
					? E('div', { class: 'sb-hint', style: 'margin-top: 4px; color: var(--warn, #e8a33d);' },
						[ _('⚠ 切换模式会重启 sing-box，约 1-2 秒中断') ])
					: ''
			]);
		};

		/* 重启后轮询等待服务回来 */
		const waitServiceBack = function(cb) {
			let n = 0;
			const tick = function() {
				n++;
				if (n > 30) { cb(false); return; }
				sb.callStatus().then(function(st) {
					if (st && st.running) cb(true);
					else window.setTimeout(tick, 1000);
				}).catch(function() { window.setTimeout(tick, 1000); });
			};
			window.setTimeout(tick, 1500);
		};

		dom.content(elModeSeg, [ sb.segmented([
			{ value: 'rule',   label: _('规则') },
			{ value: 'global', label: _('全局') },
			{ value: 'direct', label: _('直连') }
		], gmode.mode === 'custom' ? '' : gmode.mode, function(v) {
			if (v === gmode.mode) return;

			const btn = elModeSeg.querySelector('.sb-seg');
			if (btn) btn.classList.add('is-busy');
			sb.toast(_('正在切换到「%s」…').format(MODE_LABEL[v]), 'info');

			sb.callGlobalModeSet(v).then(function(r) {
				if (!r || !r.ok) {
					sb.toast((r && r.error) || _('切换失败'), 'err');
					/* 失败：把高亮拉回真实状态 */
					const cur = (gmode.mode === 'custom') ? '' : gmode.mode;
					const el = elModeSeg.querySelector('.sb-seg');
					if (el) {
						const vals = ['rule', 'global', 'direct'];
						el.querySelectorAll('.sb-seg-item').forEach(function(b, i) {
							const on = (vals[i] === cur);
							b.classList.toggle('is-active', on);
							b.setAttribute('aria-pressed', on ? 'true' : 'false');
						});
					}
					if (btn) btn.classList.remove('is-busy');
					return;
				}

				/* 成功：等 sing-box 重启回来，然后重新拉真实状态 */
				sb.toast(_('已切换为「%s」，等待服务重启…').format(MODE_LABEL[v]), 'ok');
				waitServiceBack(function(ready) {
					if (btn) btn.classList.remove('is-busy');
					if (!ready) {
						sb.toast(_('服务重启超时，请手动检查'), 'err');
						return;
					}
					sb.callGlobalModeGet().then(function(g) {
						if (g && g.ok) {
							gmode.mode = g.mode;
							gmode.outbound = g.outbound;
							renderModeInfo(g.mode, g.outbound);
						}
						sb.toast(_('已切换为「%s」').format(MODE_LABEL[v]), 'ok');
					}).catch(function() {});
				});
			}).catch(function(e) {
				if (btn) btn.classList.remove('is-busy');
				sb.toast(String(e), 'err');
			});
		}) ]);

		dom.content(elProxySeg, [ E('div', { class: 'sb-hint' }, [ _('读取中…') ]) ]);
		renderModeInfo(gmode.mode, gmode.outbound);

		/* ── 快捷操作（去掉与上方重复的"重启服务"） ── */
		const quickActions = [
			{ label: _('关闭全部连接'), act: () => sb.callCloseConnections() },
			{ label: _('清理 DNS 缓存'), act: () => sb.callFlushDns() },
			{ label: _('重新检查连通'), act: () => view._doAccessCheck(elAccessGrid) },
			{ label: _('刷新 IP 信息'), act: () => view._loadIpInfo(elIpGrid) }
		];

		window.setTimeout(function() {
			view._loadRunStats(elRunData);
			view._loadIpInfo(elIpGrid);
			view._doAccessCheck(elAccessGrid);
		}, 200);

		/* ★ 5 秒而非 3 秒：一轮 run_stats 实际耗时 4-7s（含 2 个 RPC + 进程调用），
		 *   3 秒间隔会导致请求永久堆积，最终拖垮整个 LuCI。 */
		poll.add(function() { view._loadRunStats(elRunData); }, 5);

		return E('div', { class: 'sb-wrap oc-wrap' }, [

			E('div', { class: 'oc-hero' }, [
				E('h2', { class: 'oc-hero-title' }, [ 'sing-box' ]),
				E('p', { class: 'oc-hero-sub' }, [
					_('运行在 OpenWrt 上的 sing-box 客户端 · Hysteria2 / VLESS(REALITY) / VMess / TUIC · 规则分流')
				])
			]),

			/* 第一行：运行状态 / 访问入口 / 当前出站 */
			E('div', { class: 'oc-row oc-row--3' }, [
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [
						E('h3', { class: 'oc-card-title' }, [ _('运行状态') ]),
						E('span', { class: 'oc-badge-ver' }, [ status.version || '—' ])
					]),
					E('div', { class: 'oc-status-row' }, [ elStatusBadge, svcSwitch ]),
					elSvcBtns
				]),

				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [ E('h3', { class: 'oc-card-title' }, [ _('访问入口') ]) ]),
					E('div', { class: 'oc-kv' }, [
						E('div', { class: 'oc-kv-row' }, [
							E('span', { class: 'oc-kv-key' }, [ _('混合代理') ]),
							E('code', { class: 'oc-kv-val' }, [ window.location.hostname + ':' + (sb.MIXED_PORT || 5330) ])
						]),
						E('div', { class: 'oc-kv-row' }, [
							E('span', { class: 'oc-kv-key' }, [ _('Clash API') ]),
							E('code', { class: 'oc-kv-val' }, [ window.location.hostname + ':8080/api' ])
						])
					]),
					E('div', { class: 'sb-hint' }, [ _('混合代理支持 HTTP/SOCKS5；API 已注入密钥，可直接用于客户端。') ])
				]),

				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [ E('h3', { class: 'oc-card-title' }, [ _('控制台') ]) ]),
					E('button', {
						class: 'oc-big-btn', type: 'button', style: 'width:100%;',
						click: function() {
							/* 当前标签页内跳转，不新开窗口 */
							location.href = '/cgi-bin/luci/admin/services/singbox/zashboard';
						}
					}, [ _('打开 Zashboard') ]),
					E('div', { class: 'sb-hint' }, [ _('节点分组 / 连接追踪 / 规则 / 实时日志') ])
				])
			]),

			/* 第二行：运行模式 / 当前出站 / 运行数据 */
			E('div', { class: 'oc-row oc-row--3' }, [
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [ E('h3', { class: 'oc-card-title' }, [ _('运行模式') ]) ]),
					elModeSeg
				]),
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [ E('h3', { class: 'oc-card-title' }, [ _('当前出站') ]) ]),
					elProxySeg
				]),
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [
						E('h3', { class: 'oc-card-title' }, [ _('运行数据') ]),
						E('button', {
							class: 'oc-icon-btn', type: 'button', title: _('刷新'),
							click: function() { view._loadRunStats(elRunData); }
						}, [ sb.icon('refresh', 13) ])
					]),
					elRunData
				])
			]),

			/* 第三行：IP 地址（本地 + 代理） */
			E('div', { class: 'oc-row oc-row--2' }, [
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [
						E('h3', { class: 'oc-card-title' }, [ _('IP 地址') ]),
						E('button', {
							class: 'oc-icon-btn', type: 'button', title: _('刷新'),
							click: function() { view._loadIpInfo(elIpGrid); }
						}, [ sb.icon('refresh', 13) ])
					]),
					elIpGrid
				]),
				E('div', { class: 'oc-card' }, [
					E('div', { class: 'oc-card-head' }, [
						E('h3', { class: 'oc-card-title' }, [ _('访问检查') ]),
						E('button', {
							class: 'oc-icon-btn', type: 'button', title: _('刷新'),
							click: function() { view._doAccessCheck(elAccessGrid); }
						}, [ sb.icon('refresh', 13) ])
					]),
					elAccessGrid
				])
			]),

			/* 第四行：快捷操作 */
			E('div', { class: 'oc-card' }, [
				E('div', { class: 'oc-card-head' }, [ E('h3', { class: 'oc-card-title' }, [ _('快捷操作') ]) ]),
				E('div', { class: 'oc-btn-row oc-btn-row--4' }, quickActions.map(function(a) {
					return E('button', {
						class: 'oc-quick-btn', type: 'button',
						click: function(ev) {
							const btn = ev.currentTarget;
							btn.disabled = true;
							const old = btn.textContent;
							btn.textContent = _('处理中…');
							Promise.resolve().then(a.act)
								.then(function() { sb.toast(a.label + ' — ' + _('完成'), 'ok'); })
								.catch(function(e) { sb.toast(String(e), 'err'); })
								.finally(function() { btn.disabled = false; btn.textContent = old; });
						}
					}, [ a.label ]);
				}))
			])
		]);
	},

	/* ── 运行数据 ── */
	_loadRunStats: function(el) {
		/*
		 * ★ 不用 /traffic 接口计算速率。
		 *
		 * Clash 的 /traffic 是 SSE 流式接口，永不主动关闭。用 wget + head 读取
		 * 必须等第 2 帧到达（sing-box 每 1 秒推一帧），实测稳定阻塞 **3016ms**。
		 * 而本方法每 5 秒轮询一次 → 每次卡 3 秒，页面"永远在转圈"。
		 *
		 * 改为：用 /connections 返回的累计字节数做差分，在 run_stats 里算。
		 * /connections 有明确 EOF，实测 15ms。
		 */
		return sb.callRunStats().then(function(stats) {
			if (!stats || !stats.ok) return;

			/* 速率由后端基于累计字节差分算出 */
			const t = { up: stats.up_rate || 0, down: stats.down_rate || 0 };

			const item = function(label, value, cls) {
				return E('div', { class: 'oc-stat' }, [
					E('div', { class: 'oc-stat-label' }, [ label ]),
					E('div', { class: 'oc-stat-value ' + (cls || '') }, [ value ])
				]);
			};

			const fmtRate = function(n) {
				n = Number(n) || 0;
				if (n < 1024) return n + ' B/s';
				if (n < 1048576) return (n / 1024).toFixed(1) + ' KB/s';
				return (n / 1048576).toFixed(2) + ' MB/s';
			};
			const fmtBytes = function(n) {
				n = Number(n) || 0;
				if (n < 1024) return n + ' B';
				if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
				if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
				return (n / 1073741824).toFixed(2) + ' GB';
			};

			dom.content(el, [
				item(_('上传速率'), fmtRate(t.up), 'oc-stat--blue'),
				item(_('下载速率'), fmtRate(t.down), 'oc-stat--green'),
				item(_('上传总量'), fmtBytes(stats.up_total)),
				item(_('下载总量'), fmtBytes(stats.down_total)),
				item(_('活动连接'), String(stats.conn_count || 0)),
				item(_('内存占用'), stats.mem_kb ? (stats.mem_kb / 1024).toFixed(1) + ' MB' : '—'),
				item(_('系统负载'), String(stats.load1 || '—')),
				item(_('累计 CPU'), ((stats.cpu_ticks || 0) / 100).toFixed(1) + ' s')
			]);
		});
	},

	/* ── IP 信息：本地（后端）+ 代理（浏览器查询） ── */
	_loadIpInfo: function(el) {
		dom.content(el, [ E('div', { class: 'oc-muted' }, [
			E('span', { class: 'sb-loading' }), ' ' + _('检测中…')
		]) ]);

		/* 1) 本地出口：由后端用国内源查询（K3 直连可达，0 秒） */
		const pLocal = sb.callIpInfo()
			.then(function(r) {
				return (r && r.ok && r.results) ? r.results : [];
			})
			.catch(function() { return []; });

		/* 2) 代理出口：由浏览器查询。
		 *    浏览器的网络已由 K3 透明代理，因此这里拿到的是**代理节点出口 IP**。
		 *    用多个源做冗余，任一成功即可。 */
		const fetchJson = function(url, timeoutMs) {
			return new Promise(function(resolve) {
				let done = false;
				const timer = window.setTimeout(function() {
					if (!done) { done = true; resolve(null); }
				}, timeoutMs || 6000);

				fetch(url, { cache: 'no-store' })
					.then(function(r) { return r.ok ? r.text() : null; })
					.then(function(t) {
						if (done) return;
						done = true;
						window.clearTimeout(timer);
						resolve(t);
					})
					.catch(function() {
						if (done) return;
						done = true;
						window.clearTimeout(timer);
						resolve(null);
					});
			});
		};

		/*
		 * ★ 只查 HTTPS 源，不用明文 http://ip-api.com
		 *
		 * 两个原因：
		 *   1. 明文 HTTP 走代理时稳定性差（实测偶尔卡满 6s 超时）
		 *   2. 它会把你的出口 IP + 归属地报给第三方，且每次开页面都查一次
		 *
		 * 改为：ipify（HTTPS，纯 IP）拿 IP，归属地由后端本地判断（不联网）。
		 * 另加 sessionStorage 缓存 5 分钟，避免反复查询。
		 */
		const PROXY_CACHE_KEY = 'sb_proxy_ip_cache';
		const PROXY_CACHE_TTL = 5 * 60 * 1000;

		const pProxy = Promise.resolve().then(function() {
			/* 缓存命中直接用 */
			try {
				const raw = sessionStorage.getItem(PROXY_CACHE_KEY);
				if (raw) {
					const c = JSON.parse(raw);
					if (c && c.at && (Date.now() - c.at) < PROXY_CACHE_TTL && c.ip)
						return { cached: c };
				}
			} catch (e) { /* 忽略 */ }

			return Promise.all([
				fetchJson('https://api.ipify.org?format=json', 5000)
			]).then(function(res) {
				let ip = null;
				if (res[0]) {
					try {
						const d = JSON.parse(res[0]);
						if (d && d.ip) ip = d.ip;
					} catch (e) { /* 可能是纯文本 */ }
					if (!ip && /^[0-9.]+$/.test(String(res[0]).trim()))
						ip = String(res[0]).trim();
				}
				return { ip: ip };
			});
		}).then(function(res) {
			const out = [];
			let proxyIp = null;

			/* 缓存命中 or 新查询结果，统一取 ip 字段 */
			if (res && res.cached) {
				proxyIp = res.cached.ip || null;
			} else if (res && res.ip) {
				proxyIp = res.ip;
				/* 写入 sessionStorage 缓存（同一标签页 5 分钟内不重复查） */
				try {
					sessionStorage.setItem(PROXY_CACHE_KEY, JSON.stringify({
						at: Date.now(), ip: proxyIp
					}));
				} catch (e) { /* ignore */ }
			}

			if (proxyIp) {
				out.push({
					kind: 'proxy', src: 'ipify',
					ip: proxyIp,
					loc: _('代理节点出口')
				});
			}
			return out;
		}).catch(function() { return []; });

		return Promise.all([ pLocal, pProxy ]).then(function(res) {
			const local = res[0] || [];
			const proxy = res[1] || [];
			const all = local.concat(proxy);

			if (!all.length) {
				dom.content(el, [ E('div', { class: 'oc-muted' }, [ _('检测失败') ]) ]);
				return;
			}

			dom.content(el, all.map(function(x) {
				const isProxy = (x.kind === 'proxy');
				return E('div', { class: 'oc-ipcard' + (isProxy ? ' oc-ipcard--proxy' : '') }, [
					E('div', { class: 'oc-ipcard-src' }, [
						E('span', { class: 'oc-ipcard-tag ' + (isProxy ? 'is-proxy' : 'is-local') },
							[ isProxy ? _('代理出口') : _('本地出口') ]),
						' ' + (x.src || '')
					]),
					E('div', { class: 'oc-ipcard-ip' }, [ x.ip || '—' ]),
					E('div', { class: 'oc-ipcard-loc' }, [ x.loc || '—' ])
				]);
			}));
		});
	},

	/* ── 访问检查 ── */
	_doAccessCheck: function(el) {
		dom.content(el, [ E('div', { class: 'oc-muted' }, [
			E('span', { class: 'sb-loading' }), ' ' + _('检测中…')
		]) ]);

		return sb.callAccessCheck().then(function(r) {
			if (!r || !r.ok) {
				dom.content(el, [ E('div', { class: 'oc-muted' }, [ _('检测失败') ]) ]);
				return;
			}

			const list = r.results || [];

			dom.content(el, list.map(function(x) {
				let cls = 'is-fail', dot = 'oc-dot--err', text = _('失败');
				if (x.ok) {
					text = x.ms + ' ms';
					if (x.ms < 400)      { cls = 'is-fast'; dot = 'oc-dot--ok'; }
					else if (x.ms < 900) { cls = 'is-mid';  dot = 'oc-dot--warn'; }
					else                 { cls = 'is-slow'; dot = 'oc-dot--warn'; }
				}

				return E('div', { class: 'oc-accesscard' }, [
					E('div', { class: 'oc-accesscard-name' }, [ x.name ]),
					E('div', { class: 'oc-accesscard-ms ' + cls }, [ text ]),
					E('span', { class: 'oc-dot ' + dot })
				]);
			}));
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
