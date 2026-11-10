'use strict';
'require view';
'require poll';
'require ui';
'require dom';
'require singbox.sbcommon as sb';

/*
 * sing-box 节点管理页
 *
 * 功能：
 *   - 节点列表（类型 / 服务器 / 延迟徽章）
 *   - 单节点测速 + 全部测速
 *   - 分组切换（URLTest / Selector）
 *   - 新增 / 编辑 / 删除节点（写回 config.json，后端校验后重载）
 *
 * 表单策略：常用字段图形化 + 「高级配置」JSON 文本域兜底，
 *          既保证易用性，又不必为每种协议单独建表单。
 */

const TYPE_LABELS = {
	hysteria2: 'Hysteria2',
	vless: 'VLESS',
	vmess: 'VMess',
	tuic: 'TUIC',
	trojan: 'Trojan',
	shadowsocks: 'Shadowsocks',
	socks: 'SOCKS',
	http: 'HTTP',
	wireguard: 'WireGuard',
	anytls: 'AnyTLS'
};

return view.extend({

	load: function() {
		return Promise.all([
			sb.callNodesList().catch(() => null),
			sb.callClashGet('/proxies').catch(() => null)
		]);
	},

	render: function(data) {
		sb.ensureCss();

		const nodesRes = data[0] || {};
		const proxiesRes = data[1] || {};

		if (nodesRes.ok === false) {
			return E('div', { class: 'sb-wrap' }, [
				sb.alertBox(nodesRes.error || _('Failed to load nodes'), 'err')
			]);
		}

		const nodes = nodesRes.nodes || [];
		const groups = nodesRes.groups || [];
		/* clash_get 返回 { ok, data } */
		const proxies = (proxiesRes && proxiesRes.ok && proxiesRes.data && proxiesRes.data.proxies)
			? proxiesRes.data.proxies : {};

		/* 延迟缓存：name → ms */
		const delayMap = {};

		const elList = E('div');
		const elGroups = E('div');

		/* 局部刷新：重新拉取分组状态并只更新选中态 */
		const refreshGroup = (groupTag, selectedName) => {
			const seg = document.querySelector('[data-group="' + CSS.escape(groupTag) + '"]');
			if (!seg) { renderGroups(); return; }
			seg.querySelectorAll('.sb-btn').forEach((b) => {
				const name = b.getAttribute('data-member');
				const isNow = name === selectedName;
				b.classList.toggle('sb-btn--primary', isNow);
				b.textContent = isNow ? ('✓ ' + name) : name;
			});
		};

		/* 节点增删改后：重新拉取数据并重渲染列表（不整页重载） */
		const refreshAll = () => {
			sb.callNodesList().then((r) => {
				if (!r || !r.ok) return;
				nodes.length = 0;
				(nodesRes.nodes || []).forEach(() => {});
				if (r.nodes) { nodes.splice(0, nodes.length, ...r.nodes); }
				groups.splice(0, groups.length, ...(r.groups || []));
				sb.callClashGet('/proxies').then((pr) => {
					const p2 = (pr && pr.ok && pr.data) ? pr.data.proxies : {};
					Object.keys(proxies).forEach((k) => delete proxies[k]);
					Object.assign(proxies, p2);
					renderList();
					renderGroups();
				});
			});
		};


		/* ── 延迟徽章渲染 ── */
		const delayBadge = (name) => {
			const ms = delayMap[name];
			if (ms == null) return sb.badge(_('未测速'), null);
			if (ms === -1) return sb.badge(_('超时'), 'err');
			return sb.badge(`${ms} ms`, sb.delayLevel(ms), true);
		};

		/* ── 节点列表 ── */
		const renderList = () => {
			if (!nodes.length) {
				dom.content(elList, [ sb.emptyState(_('还没有配置任何节点，点击右上角「添加节点」开始')) ]);
				return;
			}

			dom.content(elList, [ E('ul', { class: 'sb-list' }, nodes.map((n) => {
				const p = proxies[n.tag];
				const isActive = groups.some((g) => g.type === 'selector' && proxies[g.tag] && proxies[g.tag].now === n.tag);

				/* 首次进入时用 Clash 历史延迟填充 */
				if (delayMap[n.tag] == null && p && p.history && p.history.length)
					delayMap[n.tag] = p.history[p.history.length - 1].delay;

				const badgeEl = E('span', {}, [ delayBadge(n.tag) ]);

				return E('li', { class: `sb-row${isActive ? ' is-selected' : ''}` }, [
					E('div', { class: 'sb-row-main' }, [
						E('div', { class: 'sb-row-name' }, [
							n.tag,
							' ',
							sb.badge(TYPE_LABELS[n.type] || n.type, 'accent')
						]),
						E('div', { class: 'sb-row-sub' }, [
							`${n.server || '—'}:${n.port || '—'}`
						])
					]),
					E('span', { class: 'sb-nowrap', 'data-role': 'delay' }, [ badgeEl ]),

					sb.button(_('测速'), {
						small: true, icon: 'zap',
						title: _('测试 %s 的延迟').format(n.tag),
						click: () => {
							dom.content(badgeEl, [ E('span', { class: 'sb-loading' }) ]);
							return sb.callTestNode(n.tag).then((r) => {
								if (r && r.ok && r.data && r.data.delay != null && r.data.delay > 0) {
									delayMap[n.tag] = r.data.delay;
								} else {
									delayMap[n.tag] = -1;
								}
								dom.content(badgeEl, [ delayBadge(n.tag) ]);
							});
						}
					}),

					sb.button('', {
						small: true, icon: 'pencil',
						ariaLabel: _('编辑 %s').format(n.tag),
						click: () => this._editNode(n, () => refreshAll())
					}),

					sb.button('', {
						small: true, icon: 'trash', danger: true,
						ariaLabel: _('删除 %s').format(n.tag),
						click: () => {
							if (!confirm(_('确定删除节点「%s」？此操作会修改配置文件并重启服务。').format(n.tag)))
								return Promise.resolve();

							return sb.callNodeDelete(n.tag).then((r) => {
								if (r && r.ok) { sb.toast(_('已删除，服务重启中…'), 'ok'); window.setTimeout(() => refreshAll(), 2500); }
								else sb.toast((r && r.error) || _('删除失败'), 'err');
							});
						}
					})
				]);
			})) ]);
		};

		/* ── 分组切换 ── */
		const renderGroups = () => {
			const switchable = groups.filter((g) => g.type === 'selector' && g.members.length);

			if (!switchable.length) {
				dom.content(elGroups, [ sb.emptyState(_('没有可切换的节点组')) ]);
				return;
			}

			dom.content(elGroups, switchable.map((g) => {
				const now = proxies[g.tag] ? proxies[g.tag].now : null;

				return E('div', { 'data-group': g.tag, style: 'margin-bottom: 14px;' }, [
					E('div', { class: 'sb-row-gap', style: 'margin-bottom: 8px;' }, [
						E('strong', { class: 'sb-fs13' }, [ g.tag ]),
						now ? sb.badge(now, 'ok', true) : sb.badge(_('未选择'), null)
					]),
					E('div', { class: 'sb-row-gap' }, g.members.map((m) =>
						(function() {
							const btn = sb.button(m === now ? `✓ ${m}` : m, {
								small: true,
								primary: m === now,
							click: () => sb.callSelectNode(g.tag, m).then((r) => {
								if (r && r.ok) {
									sb.toast(_('%s 已切换到 %s').format(g.tag, m), 'ok');
									/* 局部刷新：只更新该分组的按钮选中态，避免整页重载 */
									refreshGroup(g.tag, m);
								} else {
									sb.toast((r && r.error) || _('切换失败'), 'err');
								}
							})
							});
							btn.setAttribute('data-member', m);
							return btn;
						})()
					))
				]);
			}));
		};

		renderList();
		renderGroups();

		/* 定时刷新延迟显示（利用 Clash 的 urltest 历史） */
		poll.add(() => sb.callClashGet('/proxies').then(() => { /* 保留轮询以更新组状态 */ }), 10);

		/* ── 顶部操作 ── */
		const toolbar = E('div', { class: 'sb-row-gap' }, [
			sb.button(_('添加节点'), {
				primary: true, icon: 'plus',
				click: () => this._editNode(null, () => refreshAll())
			}),
			sb.button(_('全部测速'), {
				icon: 'zap',
				click: () => {
					const items = document.querySelectorAll('[data-role="delay"] > span');

					/* ★ 限并发为 2。
					 *   rpcd 对同一 ubus object 的方法是串行处理的，N 个并发 RPC 会排队，
					 *   每个后端又是 wget 测速 → 10 个节点 = 100s 队列 → 全部 30s 超时，
					 *   期间 LuCI 其他页面完全无响应。 */
					const LIMIT = 2;
					let idx = 0;

					const worker = () => {
						if (idx >= nodes.length)
							return Promise.resolve();
						const k = idx++;
						return sb.callTestNode(nodes[k].tag).then((r) => {
							delayMap[nodes[k].tag] = (r && r.ok && r.data && r.data.delay > 0) ? r.data.delay : -1;
							if (items[k]) dom.content(items[k], [ delayBadge(nodes[k].tag) ]);
						}).catch(() => {}).then(worker);
					};

					return Promise.all(Array.from({ length: Math.min(LIMIT, nodes.length) }, worker))
						.then(() => sb.toast(_('测速完成'), 'ok'));
				}
			})
		]);

		return E('div', { class: 'sb-wrap' }, [
			sb.card(_('Nodes'), 'server', [ elList ], [ toolbar ]),
			sb.card(_('Node groups'), 'route', [ elGroups ]),
			sb.alertBox(
				_('修改节点会写入 /etc/sing-box/config.json，经语法校验后重启服务。原始配置已自动备份为 config.json.bak-luci。'),
				null
			)
		]);
	},

	/* ── 节点编辑弹窗 ── */
	_editNode: function(node, onDone) {
		const isNew = !node;
		const detail = (node && node.detail) ? JSON.parse(JSON.stringify(node.detail)) : {};

		/* 常用字段 */
		const fTag    = E('input', { class: 'sb-input', value: node ? node.tag : '', placeholder: 'my-node' });
		const fType   = E('select', { class: 'sb-select' },
			Object.keys(TYPE_LABELS).map((t) =>
				E('option', { value: t, selected: (node && node.type === t) ? '' : null }, [ TYPE_LABELS[t] ])
			));
		const fServer = E('input', { class: 'sb-input', value: node ? (node.server || '') : '', placeholder: '1.2.3.4' });
		const fPort   = E('input', { class: 'sb-input', value: node ? (node.port || '') : '', placeholder: '443', type: 'number' });

		/* 凭据（编辑时留空表示不修改） */
		const fSecret = E('input', {
			class: 'sb-input', type: 'password',
			placeholder: node ? _('留空则不修改') : _('密码 / UUID')
		});

		/* 高级 JSON */
		const advanced = JSON.parse(JSON.stringify(detail));
		delete advanced.tag; delete advanced.type; delete advanced.server; delete advanced.server_port;

		const fAdvanced = E('textarea', { class: 'sb-textarea', spellcheck: 'false' }, [
			JSON.stringify(advanced, null, 2)
		]);

		const errBox = E('div');

		const content = E('div', { style: 'min-width: 560px; max-width: 92vw;' }, [
			errBox,
			E('div', { class: 'sb-form-grid' }, [
				E('div', { class: 'sb-field' }, [ E('label', { class: 'sb-label' }, [ _('名称 (tag)' ) ]), fTag ]),
				E('div', { class: 'sb-field' }, [ E('label', { class: 'sb-label' }, [ _('类型') ]), fType ]),
				E('div', { class: 'sb-field' }, [ E('label', { class: 'sb-label' }, [ _('服务器') ]), fServer ]),
				E('div', { class: 'sb-field' }, [ E('label', { class: 'sb-label' }, [ _('端口') ]), fPort ]),
				E('div', { class: 'sb-field' }, [ E('label', { class: 'sb-label' }, [ _('密码 / UUID') ]), fSecret ])
			]),
			E('div', { class: 'sb-field' }, [
				E('label', { class: 'sb-label' }, [ _('高级配置 (JSON)' ) ]),
				E('div', { class: 'sb-fs12 sb-dim', style: 'margin-bottom: 6px;' }, [
					_('TLS / 传输层 / 协议特有字段，直接写 JSON。留空 {} 表示使用默认。')
				]),
				fAdvanced
			]),
			sb.alertBox(_('提示：凭据字段保存后会写入配置文件，界面上不再回显明文。'), null)
		]);

		ui.showModal(isNew ? _('Add node') : _('Edit node'), [
			content,
			E('div', { class: 'right' }, [
				E('button', { class: 'sb-btn', click: ui.hideModal }, [ _('Cancel') ]),
				' ',
				E('button', {
					class: 'sb-btn sb-btn--primary',
					click: () => {
						const tag = fTag.value.trim();
						const type = fType.value;
						const server = fServer.value.trim();
						const port = parseInt(fPort.value, 10);

						if (!tag) { dom.content(errBox, [ sb.alertBox(_('名称不能为空'), 'err') ]); return; }
						if (!server) { dom.content(errBox, [ sb.alertBox(_('服务器不能为空'), 'err') ]); return; }
						if (!port || port < 1 || port > 65535) { dom.content(errBox, [ sb.alertBox(_('端口必须是 1-65535'), 'err') ]); return; }

						let extra;
						try {
							extra = fAdvanced.value.trim() ? JSON.parse(fAdvanced.value) : {};
						} catch (e) {
							dom.content(errBox, [ sb.alertBox(_('高级配置不是合法 JSON: ') + e.message, 'err') ]);
							return;
						}

						const payload = Object.assign({}, extra, {
							type, tag, server, server_port: port
						});

						/* 凭据写入：新节点必填；编辑时仅在填写时覆盖 */
						const secret = fSecret.value;
						if (secret) {
							if (type === 'vless' || type === 'vmess' || type === 'tuic')
								payload.uuid = secret;
							else
								payload.password = secret;
						} else if (node && (detail.password === '__SET__' || detail.uuid === '__SET__')) {
							/* 编辑时不改凭据：告知后端从旧配置继承原值。
							 * 注意必须同时判断 uuid —— vless/vmess/tuic 用的是 uuid 而非 password，
							 * 原实现只判断 password，导致这三类节点编辑后丢失 uuid。 */
							payload.__keep_secret__ = true;
						}

						ui.hideModal();
						sb.callNodeSave(JSON.stringify(payload), node ? node.tag : '').then((r) => {
							if (r && r.ok) { sb.toast(_('已保存，服务重启中…'), 'ok'); window.setTimeout(onDone, 2200); }
							else sb.toast((r && r.error) || _('保存失败'), 'err');
						});
					}
				}, [ _('Save') ])
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
