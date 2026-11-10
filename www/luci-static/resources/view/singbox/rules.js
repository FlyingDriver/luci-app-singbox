'use strict';
'require view';
'require ui';
'require dom';
'require singbox.sbcommon as sb';

/*
 * sing-box 分流规则页
 *
 * 功能：
 *   1. 搜索框：按关键字过滤 37 条 route.rules
 *   2. 规则行：文字按钮（上移/下移/编辑/删除），不用 SVG，避免图标渲染问题
 *   3. 规则集行（带 rule_set 的规则）：可展开查看/编辑内部明细（.srs 反编译）
 *   4. 规则编辑器弹框：出站下拉 + JSON 条件 + 快速模板
 *
 * 规则顺序即优先级。改动经后端 sing-box check 校验后重启。
 */

const MATCH_LABELS = {
	protocol: '协议', ip_is_private: '内网地址', ip_cidr: '目标 IP 段', ip: '目标 IP',
	domain: '域名', domain_suffix: '域名后缀', domain_keyword: '域名关键字',
	domain_regex: '域名正则', rule_set: '规则集', port: '端口', port_range: '端口范围',
	inbound: '入站', network: '网络层', clash_mode: 'Clash 模式',
	source_ip_cidr: '来源 IP 段', process_name: '进程名', package_name: '包名',
	user: '用户', query_type: '查询类型', geoip: 'GeoIP', geosite: 'GeoSite'
};

const ACTION_KEYS = [ 'outbound', 'action', 'server', 'method', 'strategy',
                      'disable_cache', 'rewrite_ttl', 'client_subnet' ];

function summarizeRule(rule) {
	const parts = [];
	for (const k in rule) {
		if (ACTION_KEYS.indexOf(k) !== -1) continue;
		const v = rule[k];
		const label = MATCH_LABELS[k] || k;
		let val;
		if (Array.isArray(v))
			val = v.slice(0, 3).join(', ') + (v.length > 3 ? ' 等' + v.length + '项' : '');
		else
			val = String(v);
		parts.push(label + '=' + val);
	}
	return parts.length ? parts.join('  ·  ') : '（无条件 / 兜底）';
}

function ruleAction(rule) {
	if (rule.action) return rule.action;
	if (rule.outbound) return rule.outbound;
	if (rule.server) return 'DNS: ' + rule.server;
	return '—';
}

function isRuleSetRule(rule) {
	return Array.isArray(rule.rule_set) && rule.rule_set.length > 0;
}

return view.extend({

	load: function() {
		return Promise.all([
			sb.callRulesList().catch(() => null),
			sb.callNodesList().catch(() => null),
			sb.callStatus().catch(() => null),
			sb.callRulesetList().catch(() => null),
			sb.callTmpStats().catch(() => null)
		]);
	},

	render: function(data) {
		sb.ensureCss();

		/* ★ 关键：多层箭头函数嵌套后 this 会丢失，
		 * 必须在 render 入口捕获视图对象，供 _renderRulesetItems 等调用。 */
		const view = this;

		const res = data[0] || {};
		const nodesRes = data[1] || {};
		const status = data[2] || {};
		const rsRes = data[3] || {};
		const tmpStats = data[4] || null;

		if (res.ok === false)
			return E('div', { class: 'sb-wrap' }, [ sb.alertBox(res.error || _('读取规则失败'), 'err') ]);

		let rules = JSON.parse(JSON.stringify(res.rules || []));
		let filter = '';

		/* 出站候选 */
		const outboundOptions = [];
		(nodesRes.nodes || []).forEach((n) => outboundOptions.push(n.tag));
		(nodesRes.groups || []).forEach((g) => outboundOptions.push(g.tag));
		[ 'DIRECT', 'REJECT' ].forEach((t) => {
			if (outboundOptions.indexOf(t) === -1) outboundOptions.push(t);
		});

		const elList  = E('div');
		const elCount = E('span', { class: 'sb-badge sb-badge--accent' }, [ String(rules.length) ]);

		/* ── 搜索框 + 深度搜索开关 ── */
		let deepSearch = false;       /* 是否搜索规则集内部条目 */
		let deepCache = {};           /* tag → items 缓存（避免重复反编译） */
		let deepBusy = false;
		let deepTimer = null;

		const elSearch = E('input', {
			class: 'sb-input',
			type: 'search',
			placeholder: _('搜索规则：域名 / IP / 出站 / 规则集名…'),
			style: 'flex:1 1 240px;padding:9px 12px;font-size:13px;',
			input: function(ev) {
				filter = ev.target.value.trim().toLowerCase();

				if (deepSearch && filter) {
					/* ★ 防抖 600ms：原实现每次按键都触发一轮规则集反编译，
					 *   用户打 5 个字 = 5 轮 × 多个 RPC，搜索框直接卡死。 */
					if (deepTimer) window.clearTimeout(deepTimer);
					deepTimer = window.setTimeout(doDeepSearch, 600);
				}
				else {
					if (deepTimer) { window.clearTimeout(deepTimer); deepTimer = null; }
					renderList();
				}
			}
		});

		const elDeepToggle = E('label', {
			class: 'sb-deep-toggle',
			style: 'display:inline-flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;cursor:pointer;'
		}, [
			E('input', {
				type: 'checkbox',
				change: function(ev) {
					deepSearch = ev.target.checked;
					if (deepSearch && filter) doDeepSearch();
					else renderList();
				}
			}),
			E('span', {}, [ _('搜索规则集内部') ])
		]);

		const elDeepHint = E('div', {
			class: 'sb-dim',
			style: 'font-size:11.5px;padding:4px 2px;display:none;'
		});

		/* 深度搜索结果容器（常驻 DOM，避免 insertBefore 时机问题） */
		const elDeepResult = E('div', { style: 'display:none;' });

		/* 深度搜索：按需反编译规则集，查找内部条目 */
		const doDeepSearch = function() {
			if (deepBusy) return;
			deepBusy = true;

			dom.content(elDeepHint, [ E('span', { class: 'sb-loading' }), ' ' + _('正在搜索规则集内部…') ]);
			elDeepHint.style.display = 'block';

			/* ★ 限制本次搜索的规则集数量。
			 *   每个 tag 都要反编译一个 .srs（大 geosite 可达 10-50MB JSON），
			 *   31 个 tag 全跑会持续几十秒甚至拖垮 rpcd。
			 *   只搜前 DEEP_LIMIT 个，已缓存的优先。 */
			const DEEP_LIMIT = 8;

			let allTags = [];
			rules.forEach(function(r) {
				if (r.rule_set) r.rule_set.forEach(function(t) {
					if (allTags.indexOf(t) === -1) allTags.push(t);
				});
			});

			/* 已缓存的排前面（不用再反编译），未缓存的截断 */
			const cachedTags = allTags.filter(function(t) { return !!deepCache[t]; });
			const freshTags = allTags.filter(function(t) { return !deepCache[t]; }).slice(0, DEEP_LIMIT);
			const tags = cachedTags.concat(freshTags);
			const skipped = allTags.length - tags.length;

			if (skipped > 0) {
				elDeepHint.style.display = 'block';
				dom.content(elDeepHint, [
					E('span', { class: 'sb-dim sb-fs12' }, [
						_('本次搜索前 %d 个规则集（另有 %d 个未搜索，可缩小关键词或逐个展开查看）')
							.format(tags.length, skipped)
					])
				]);
			}

			let hits = [];   /* { tag, items: [...] } */
			let idx = 0;

			const next = function() {
				if (idx >= tags.length) {
					deepBusy = false;
					renderDeepResult(hits);
					return;
				}
				const tag = tags[idx++];

				if (deepCache[tag]) {
					const matched = deepCache[tag].filter(function(it) {
						return String(it.value).toLowerCase().indexOf(filter) !== -1;
					});
					if (matched.length) hits.push({ tag: tag, items: matched });
					next();
					return;
				}

				sb.callRulesetRead(tag).then(function(r) {
					if (r && r.ok && r.items) {
						deepCache[tag] = r.items;
						const matched = r.items.filter(function(it) {
							return String(it.value).toLowerCase().indexOf(filter) !== -1;
						});
						if (matched.length) hits.push({ tag: tag, items: matched });
					}
				}).catch(function() {}).then(next);
			};

			next();
		};

		const renderDeepResult = function(hits) {
			const total = hits.reduce(function(n, h) { return n + h.items.length; }, 0);

			elDeepHint.style.display = 'block';
			if (!total) {
				dom.content(elDeepHint, [ _('规则集内部无匹配项') ]);
				renderList();
				return;
			}

			dom.content(elDeepHint, [
				E('strong', {}, [ _('规则集内部命中 %d 条（%d 个规则集）').format(total, hits.length) ])
			]);

			/* 保留原有列表 */
			renderList();

			const box = E('div', {
				style: 'padding:10px 12px;background:rgba(59,130,246,.07);border-radius:8px;'
			});

			hits.forEach(function(h) {
				const rowsBox = E('div', { style: 'max-height:180px;overflow-y:auto;' });
				h.items.slice(0, 100).forEach(function(it) {
					rowsBox.appendChild(E('div', {
						style: 'font-size:11.5px;font-family:monospace;padding:2px 0;'
					}, [ E('span', { class: 'sb-dim' }, [ it.type + ': ' ]), String(it.value) ]));
				});

				box.appendChild(E('div', { style: 'margin-bottom:10px;' }, [
					E('div', { style: 'font-weight:600;font-size:12.5px;margin-bottom:6px;' }, [
						_('规则集: ') + h.tag + ' (' + h.items.length + ')'
					]),
					rowsBox
				]));
			});

			dom.content(elDeepResult, [ box ]);
			elDeepResult.style.display = 'block';
		};

		const persist = (nextRules, msg) =>
			sb.callRulesSave(JSON.stringify(nextRules)).then((r) => {
				if (r && r.ok) {
					rules = nextRules;
					renderList();
					sb.toast(msg || _('已保存，服务重启中…'), 'ok');
					window.setTimeout(() => location.reload(), 4000);
				} else {
					sb.toast((r && r.error) || _('保存失败'), 'err');
				}
			});

		/* ── 渲染规则列表 ── */
		const renderList = () => {
			const visible = rules
				.map((rule, idx) => ({ rule, idx }))
				.filter(({ rule }) => {
					if (!filter) return true;
					const hay = (summarizeRule(rule) + ' ' + ruleAction(rule) +
					             ' ' + JSON.stringify(rule)).toLowerCase();
					return hay.indexOf(filter) !== -1;
				});

			dom.content(elCount, [ filter ? (visible.length + '/' + rules.length) : String(rules.length) ]);

			if (!visible.length) {
				dom.content(elList, [ sb.emptyState(filter ? _('没有匹配的规则') : _('没有分流规则')) ]);
				return;
			}

			dom.content(elList, [ E('ul', { class: 'sb-list' }, visible.map(({ rule, idx }) => {
				const rsRule = isRuleSetRule(rule);
				const ruleSets = rsRule ? rule.rule_set : [];

				/* 规则集明细容器 */
				const elDetail = E('div', { class: 'sb-rs-detail' });
				let expanded = false;
				let loaded = false;

				const toggleDetail = () => {
					if (!rsRule) return;

					if (expanded) {
						elDetail.style.display = 'none';
						expanded = false;
						return;
					}

					elDetail.style.display = 'block';
					expanded = true;

					if (loaded) return;
					loaded = true;

					const tag = ruleSets[0];
					dom.content(elDetail, [ E('div', { class: 'sb-dim sb-fs12', style: 'padding:10px 12px;' },
						[ E('span', { class: 'sb-loading' }), ' ' + _('正在展开规则集 %s …').format(tag) ]) ]);

					sb.callRulesetRead(tag).then((r) => {
						if (!r || !r.ok) {
							dom.content(elDetail, [ sb.alertBox((r && r.error) || _('读取失败'), 'err') ]);
							return;
						}
						view._renderRulesetItems(elDetail, tag, r.items, () => {
							/* 保存后刷新整个列表 */
							sb.callRulesList().then((rr) => {
								if (rr && rr.ok) {
									rules = JSON.parse(JSON.stringify(rr.rules));
									renderList();
								}
							});
						});
					});
				};

				const liKids = [];
				liKids.push(E('span', { class: 'sb-badge sb-rule-idx' }, [ String(idx + 1) ]));

				liKids.push(
					E('div', { class: 'sb-row-main', style: 'cursor:pointer;',
						click: (ev) => { if (!ev.target.closest('.sb-btn')) toggleDetail(); } }, [
						E('div', { class: 'sb-rule-action' }, [
							ruleAction(rule),
							rsRule ? sb.badge(_('规则集') + ' · ' + ruleSets.join(','), 'accent') : ''
						]),
						E('div', { class: 'sb-row-sub' }, [ summarizeRule(rule) ])
					])
				);

				/* ★ 文字按钮（不用 SVG）；可选按钮先构建再过滤，避免空值破坏 E() */
				const actBtns = [];

				if (rsRule) {
					actBtns.push(E('button', {
						class: 'sb-btn sb-btn--sm',
						type: 'button',
						title: _('展开/收起规则集明细'),
						click: function() { toggleDetail(); }
					}, [ '明细' ]));
				}

				actBtns.push(

						E('button', {
							class: 'sb-btn sb-btn--sm', type: 'button',
							disabled: idx === 0 ? '' : null,
							click: () => {
								const n = rules.slice();
								const t = n[idx - 1]; n[idx - 1] = n[idx]; n[idx] = t;
								return persist(n, _('已上移'));
							}
						}, [ '↑' ]),

						E('button', {
							class: 'sb-btn sb-btn--sm', type: 'button',
							disabled: idx === rules.length - 1 ? '' : null,
							click: () => {
								const n = rules.slice();
								const t = n[idx + 1]; n[idx + 1] = n[idx]; n[idx] = t;
								return persist(n, _('已下移'));
							}
						}, [ '↓' ]),

						E('button', {
							class: 'sb-btn sb-btn--sm', type: 'button',
							click: () => view._editRule(rule, idx, rules, outboundOptions, (updated, mode) => {
								if (mode === 'delete') {
									const n = rules.slice(); n.splice(idx, 1);
									return persist(n, _('规则已删除'));
								}
								const n = rules.slice(); n[idx] = updated;
								return persist(n, _('规则已更新，服务重启中…'));
							})
						}, [ _('编辑') ]),

						E('button', {
							class: 'sb-btn sb-btn--sm sb-btn--danger', type: 'button',
							click: () => {
								if (!confirm(_('删除第 %d 条规则？').format(idx + 1))) return Promise.resolve();
								const n = rules.slice(); n.splice(idx, 1);
								return persist(n, _('已删除'));
							}
						}, [ _('删除') ])
				);   /* 结束 actBtns.push(...) */

				liKids.push(E('div', { class: 'sb-rule-actions' }, actBtns));
				liKids.push(elDetail);

				return E('li', { class: 'sb-row sb-rule-row' }, liKids);
			})) ]);
		};

		renderList();

		/* ── 临时文件与存储占用卡片 ──
		 *
		 * 插件的规则集编辑会在 /tmp（tmpfs，内存）里生成反编译 JSON，
		 * 大规则集可达 1MB+。虽然 tmpfs 重启即清空，但运行期累积会挤占内存。
		 * 这里展示占用情况，超过阈值（60%）给出告警并提示一键清理。 */
		const elTmpInfo = E('div', { class: 'sb-fs12' });
		const elTmpBox = E('div', {});

		const renderTmp = (st) => {
			dom.content(elTmpBox, []);
			if (!st || !st.ok) {
				elTmpBox.appendChild(E('span', { class: 'sb-dim sb-fs12' }, [ _('无法读取临时文件统计') ]));
				return;
			}

			const p = st.plugin || {};
			const fs = st.tmpfs || {};
			const pct = fs.used_pct || 0;
			const pluginBytes = p.total_bytes || 0;

			/* 阈值：tmpfs 使用 >60% 或插件占用 >20MB 时告警 */
			const warn = pct >= 60 || pluginBytes > 20 * 1024 * 1024;

			const rows = [];

			rows.push(E('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;' }, [
				E('span', {}, [
					E('span', { class: 'sb-dim' }, [ _('tmpfs 内存') + '：' ]),
					sb.badge(`${pct}%`, warn ? 'err' : (pct >= 40 ? 'warn' : 'ok'), true),
					E('span', { class: 'sb-dim sb-fs12' }, [
						` ${sb.fmtBytes(fs.used_bytes || 0)} / ${sb.fmtBytes(fs.total_bytes || 0)}`
					])
				]),
				E('span', {}, [
					E('span', { class: 'sb-dim' }, [ _('插件临时文件') + '：' ]),
					E('code', {}, [ sb.fmtBytes(pluginBytes) ])
				])
			]));

			/* 明细（只有非零项才显示） */
			const detail = [];
			if (p.decompile_files > 0)
				detail.push(_('反编译缓存 %d 个 / %s').format(p.decompile_files, sb.fmtBytes(p.decompile_bytes || 0)));
			if (p.count_files > 0)
				detail.push(_('计数缓存 %d 个 / %s').format(p.count_files, sb.fmtBytes(p.counts_bytes || 0)));

			if (detail.length)
				rows.push(E('div', { class: 'sb-dim sb-fs12', style: 'margin-bottom:8px;' }, [ detail.join(' · ') ]));

			if (warn) {
				rows.push(sb.alertBox(
					_('临时文件占用偏高。清理不会影响路由规则与服务（反编译缓存会在下次展开时自动重建）。'), 'warn'));
			}

			elTmpBox.appendChild(E('div', {}, rows));
		};

		renderTmp(tmpStats);

		const tmpCard = sb.card(_('临时文件与存储'), 'server', [ elTmpBox ], [
			E('button', {
				class: 'sb-btn', type: 'button',
				title: _('清理规则集反编译缓存、探针结果、IP 缓存和孤儿计数缓存'),
				click: function(ev) {
					const b = ev.currentTarget;
					b.disabled = true; b.textContent = _('清理中…');
					sb.callTmpCleanup('all').then(function(r) {
						b.disabled = false; b.textContent = _('清理临时文件');
						if (r && r.ok) {
							sb.toast(_('已清理 %d 项').format(r.removed || 0), 'ok');
							return sb.callTmpStats().then(renderTmp).catch(function() {});
						}
						sb.toast((r && r.error) || _('清理失败'), 'err');
					}).catch(function() {
						b.disabled = false; b.textContent = _('清理临时文件');
						sb.toast(_('清理失败'), 'err');
					});
				}
			}, [ _('清理临时文件') ])
		]);

		return E('div', { class: 'sb-wrap' }, [
			sb.card(_('分流规则'), 'route', [
				E('div', { style: 'margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;' }, [
					elSearch, elDeepToggle
				]),
				elDeepHint,
				elDeepResult,
				E('div', { class: 'sb-row-gap', style: 'margin-bottom:12px;flex-wrap:wrap;' }, [
					elCount,
					E('span', { class: 'sb-dim sb-fs12' }, [ _('顺序即优先级，越靠前越先匹配。final：') ]),
					sb.badge(res.final || '—', 'accent'),
					E('span', { class: 'sb-dim sb-fs12' }, [ '· ' + _('模式：') ]),
					sb.badge(status.mode || '—', 'ok', true)
				]),
				elList
			], [
				E('button', {
					class: 'sb-btn', type: 'button',
					title: _('把出站目标相同的多条规则合并成一条，减少冗余'),
					click: function(ev) {
						if (!confirm(_('合并相同出站目标的规则？\n\n合并后规则数会减少，分流效果不变，且便于管理。')))
							return;
						const b = ev.currentTarget;
						b.disabled = true; b.textContent = _('合并中…');
						sb.callRulesMerge().then(function(r) {
							b.disabled = false; b.textContent = _('合并重复规则');
							if (r && r.ok) {
								if (r.changed)
									sb.toast(_('已合并：%d → %d 条').format(r.before, r.after), 'ok');
								else
									sb.toast(_('无需合并（当前已是 %d 条）').format(r.after), 'info');
								window.setTimeout(function() { location.reload(); }, 3000);
							} else {
								sb.toast((r && r.error) || _('合并失败'), 'err');
							}
						});
					}
				}, [ _('合并重复规则') ]),

				E('button', {
					class: 'sb-btn sb-btn--primary', type: 'button',
					click: () => view._editRule(null, -1, rules, outboundOptions, (created) => {
						const n = rules.slice(); n.push(created);
						return persist(n, _('规则已添加，服务重启中…'));
					})
				}, [ '+ ' + _('新增规则') ])
			]),

			sb.alertBox(
				_('提示：点规则行标题可打开编辑器；带「规则集」标记的规则点「明细」可展开内部条目并逐条增删改（保存后自动重新编译 .srs）。'),
				null
			),
			tmpCard
		]);
	},

	/* ── 规则集明细编辑器 ── */
	_renderRulesetItems: function(el, tag, items, onSaved) {
		try {
			let list = items.slice();

			const elSearch = E('input', {
				class: 'sb-input', type: 'search',
				placeholder: _('在此规则集内搜索…'),
				style: 'padding:7px 10px;font-size:12px;min-width:180px;'
			});

			const elBody = E('div', { style: 'max-height:420px;overflow-y:auto;' });

			const renderItems = () => {
				const q = (elSearch.value || '').trim().toLowerCase();
				const vis = [];
				list.forEach((it, i) => {
					if (!q || String(it.value || '').toLowerCase().indexOf(q) !== -1)
						vis.push({ it: it, i: i });
				});

				/* 表头 */
				const thead = E('thead', {}, [ E('tr', {}, [
					E('th', { style: 'width:130px;' }, [ _('类型') ]),
					E('th', {}, [ _('值') ]),
					E('th', { style: 'width:60px;' }, [ _('操作') ])
				]) ]);

				/* 表体：逐行 push，避免嵌套数组被 String() 化 */
				const tbody = E('tbody');
				vis.forEach((item) => {
					const it = item.it;
					const idx = item.i;

					const btnDel = E('button', {
						class: 'sb-btn sb-btn--sm sb-btn--danger',
						type: 'button',
						click: function() {
							if (!confirm(_('删除该条目？') + '\n' + it.value)) return;
							list.splice(idx, 1);
							renderItems();
						}
					}, [ _('删') ]);

					tbody.appendChild(E('tr', {}, [
						E('td', {}, [ E('code', { style: 'font-size:11.5px;' }, [ String(it.type) ]) ]),
						E('td', {}, [ E('span', { style: 'font-size:12px;word-break:break-all;' }, [ String(it.value) ]) ]),
						E('td', {}, [ btnDel ])
					]));
				});

				dom.content(elBody, [
					E('div', { class: 'sb-dim', style: 'padding:6px 2px;font-size:11.5px;' }, [
						_('共 %d 条').format(list.length) + (q ? _('，匹配 %d 条').format(vis.length) : '')
					]),
					E('table', { class: 'sb-rs-table' }, [ thead, tbody ])
				]);
			};

			renderItems();
			elSearch.addEventListener('input', renderItems);

			const btnAdd = E('button', {
				class: 'sb-btn sb-btn--sm sb-btn--primary', type: 'button',
				click: function() {
					const v = prompt(_('新增条目：输入值（如 example.com 或 1.2.3.0/24）'));
					if (!v || !v.trim()) return;
					const t = prompt(_('条目类型（domain_suffix / domain / domain_keyword / ip_cidr）'),
						'domain_suffix');
					if (!t || !t.trim()) return;
					list.push({ type: t.trim(), value: v.trim() });
					renderItems();
				}
			}, [ '+ ' + _('添加条目') ]);

			const btnSave = E('button', {
				class: 'sb-btn sb-btn--sm sb-btn--primary', type: 'button',
				click: function(ev) {
					const btn = ev.currentTarget;
					btn.disabled = true;
					const old = btn.textContent;
					btn.textContent = _('编译中…');
					sb.callRulesetSave(tag, JSON.stringify(list)).then(function(r) {
						btn.disabled = false;
						btn.textContent = old;
						if (r && r.ok) {
							sb.toast(_('已编译保存 %d 条，服务重启中…').format(r.count || list.length), 'ok');
							if (onSaved) onSaved();
						} else {
							sb.toast((r && r.error) || _('保存失败'), 'err');
						}
					}).catch(function(e) {
						btn.disabled = false;
						btn.textContent = old;
						sb.toast(String(e), 'err');
					});
				}
			}, [ _('保存并编译') ]);

			const headRow = E('div', {
				class: 'sb-row-gap',
				style: 'margin-bottom:8px;flex-wrap:wrap;align-items:center;'
			}, [
				E('strong', { style: 'font-size:13px;' }, [ _('规则集明细：') + tag ]),
				elSearch,
				btnAdd,
				btnSave
			]);

			dom.content(el, [
				E('div', {
					style: 'padding:10px 12px;background:rgba(127,127,127,.06);border-radius:8px;'
				}, [ headRow, elBody ])
			]);
		} catch (e) {
			dom.content(el, [ sb.alertBox(_('规则集渲染异常: ') + (e && e.message ? e.message : String(e)), 'err') ]);
		}
	},

	/* ── 规则编辑器弹框 ── */
	_editRule: function(rule, idx, rules, outboundOptions, onSave) {
		const self = this;
		const isNew = !rule;
		const errBox = E('div');

		const curOut = (rule && (rule.outbound || rule.action)) || 'DIRECT';

		const fOutbound = E('select', { class: 'sb-select', style: 'width:100%;' },
			outboundOptions.map((t) =>
				E('option', { value: t, selected: t === curOut ? '' : null }, [ t ])));

		const editable = {};
		if (rule) {
			for (const k in rule) { if (k !== 'outbound') editable[k] = rule[k]; }
		} else {
			editable['domain_suffix'] = [ '.example.com' ];
		}

		const fJson = E('textarea', {
			class: 'sb-textarea', spellcheck: 'false',
			style: 'min-height:180px;width:100%;font-family:monospace;font-size:12px;'
		}, [ JSON.stringify(editable, null, 2) ]);

		const templates = [
			{ l: _('域名后缀'),   j: { domain_suffix: [ '.example.com' ] } },
			{ l: _('域名关键字'), j: { domain_keyword: [ 'keyword' ] } },
			{ l: _('精确域名'),   j: { domain: [ 'www.example.com' ] } },
			{ l: 'IP 段',        j: { ip_cidr: [ '1.2.3.0/24' ] } },
			{ l: 'GeoIP CN',     j: { geoip: [ 'cn' ] } },
			{ l: _('规则集'),     j: { rule_set: [ 'geosite-cn' ] } },
			{ l: _('进程名'),     j: { process_name: [ 'aria2c' ] } },
			{ l: _('端口'),       j: { port: [ 443 ] } }
		];

		const content = E('div', { style: 'min-width:560px;max-width:92vw;max-height:74vh;overflow-y:auto;' }, [
			errBox,

			E('div', { style: 'margin-bottom:14px;' }, [
				E('label', { class: 'sb-label' }, [ _('出站目标') ]),
				fOutbound,
				E('div', { class: 'sb-dim sb-fs12', style: 'margin-top:4px;' }, [
					_('命中的流量由该出站处理。可选节点、分组或 DIRECT / REJECT。')
				])
			]),

			E('div', {}, [
				E('label', { class: 'sb-label' }, [ _('匹配条件 (JSON)') ]),
				E('div', { class: 'sb-row-gap', style: 'margin-bottom:8px;flex-wrap:wrap;' },
					templates.map((t) => E('button', {
						class: 'sb-btn sb-btn--sm', type: 'button',
						click: (ev) => { ev.preventDefault(); fJson.value = JSON.stringify(t.j, null, 2); }
					}, [ t.l ]))),
				fJson,
				E('div', { class: 'sb-dim sb-fs12', style: 'margin-top:6px;' }, [
					_('可用键：domain_suffix / domain / domain_keyword / domain_regex / ip_cidr / ip_is_private / protocol / port / port_range / process_name / rule_set / geoip / geosite')
				])
			])
		]);

		const actions = E('div', { style: 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;' }, [
			!isNew ? E('button', {
				class: 'sb-btn sb-btn--danger', type: 'button',
				click: function() {
					if (!confirm(_('确认删除该规则？'))) return;
					self._closeModal();
					onSave(null, 'delete');
				}
			}, [ _('删除此规则') ]) : '',

			E('button', {
				class: 'sb-btn', type: 'button',
				click: function() { self._closeModal(); }
			}, [ _('取消') ]),

			E('button', {
				class: 'sb-btn sb-btn--primary', type: 'button',
				click: function() {
					let cond;
					try {
						cond = fJson.value.trim() ? JSON.parse(fJson.value) : {};
					} catch (e) {
						dom.content(errBox, [ sb.alertBox(_('JSON 不合法: ') + e.message, 'err') ]);
						return;
					}
					if (typeof cond !== 'object' || Array.isArray(cond)) {
						dom.content(errBox, [ sb.alertBox(_('匹配条件必须是 JSON 对象'), 'err') ]);
						return;
					}

					const payload = Object.assign({}, cond, { outbound: fOutbound.value });
					if (rule && rule.action && !rule.outbound) delete payload.outbound;

					self._closeModal();
					onSave(payload);
				}
			}, [ isNew ? _('添加') : _('保存') ])
		]);

		ui.showModal(isNew ? _('新增规则') : _('编辑规则 #%d').format(idx + 1),
			[ content, actions ]);
	},

	/* 关闭弹框
	 *
	 * ★ 必须理解 LuCI 的 modal 机制：
	 *   LuCI 在启动时创建一次 #modal_overlay > .modal，之后 showModal 一直复用它。
	 *   hideModal() 只是移除 body 的 'modal-overlay-active' 类，可见性由 CSS 控制。
	 *   因此绝对不能 remove() 掉 .modal 节点，否则 modalDiv.firstElementChild 为 null，
	 *   下一次 showModal 会崩掉（这就是"点取消后弹窗再也打不开"的根因）。
	 */
	_closeModal: function() {
		try { ui.hideModal(); } catch (e) { /* ignore */ }
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
