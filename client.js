// dsh-html-inspector — HTML 选区模式独立插件 (client 端)
// 1) 拦截浏览器页签地址栏的本机 (loopback) 输入, 自动改走 /inspector/proxy;
// 2) 全局监听页面内选区消息, 把定位信息写入当前会话输入框;
// 3) 给 dsh-better-sidebar 浏览器页签工具栏加「选区模式」开关按钮 (存在则加,
//    不存在也不影响其余功能), 选中后自动退出选区状态;
// 4) 文件树打开的 HTML 预览 (编辑器 iframe, /sidebar/html 路由) 同样支持:
//    开启选区时把预览帧换成注入了 inspector 的同内容副本 (fetch 原文 + 补
//    <base> 保相对资源 + srcdoc 重挂), 选中结果带「文件预览」来源标记。
window.__ModuleLoader__.load({
	id: "dsh-html-inspector",
	factory: (require) => {
		const React = require("react");

		const SRC = "dsh-html-inspector";
		const PROXY_PATH = "/inspector/proxy?url=";

		function isLoopback(hostname) {
			const host = String(hostname || "").replace(/^[\[]|\]$/g, "").toLowerCase();
			if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
			const parts = host.split(".");
			return parts.length === 4 && parts[0] === "127" && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
		}

		// 地址栏输入 → 代理 URL。非本机目标返回 null (不干预)。
		function toProxyUrl(rawInput, origin) {
			const trimmed = String(rawInput || "").trim();
			if (!trimmed) return null;
			let text = trimmed;
			if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text)) text = "http://" + text;
			let u;
			try {
				u = new URL(text);
			} catch {
				return null;
			}
			if (u.protocol !== "http:") return null;
			try {
				if (new URL(origin).origin === u.origin) return null; // GUI 自身不拦
			} catch {}
			if (!isLoopback(u.hostname)) return null;
			// 0.18.0 起 navigateTo 走 normalizeBrowserUrl:相对路径会被当成无效网址。
			// 改为绝对 URL(GUI 自身 origin),命中其 self-origin 放行分支,沙箱模型不变。
			return window.location.origin + PROXY_PATH + encodeURIComponent("http://" + u.host + u.pathname + u.search);
		}

		function decodeProxyUrl(u) {
			try {
				const x = new URL(u, window.location.origin);
				if (x.pathname === "/inspector/proxy") return decodeURIComponent(x.searchParams.get("url") || u);
			} catch {}
			return u;
		}

		// ── 文件预览 (/sidebar/html) 选区支持 ──
		// 编辑器 HTML 预览的 iframe 是沙箱 opaque origin (响应头 CSP sandbox),
		// 无法直接注入; 改为「fetch 原文 + 注入 inspector + srcdoc 重挂」: 副本在
		// GUI 无 CSP 环境里运行, postMessage 直达宿主; <base> 指回 /sidebar/html
		// 同目录, 页面相对资源 (styles.css / app.js) 照常加载, 行为与原文档一致。
		const PREVIEW_SRC = /\/sidebar\/html\//;
		// 选区开关: 浏览器页签与文件预览共用。手动关闭只在「本标签页会话」内记忆
		// (sessionStorage), 关掉标签页/重开浏览器后重新默认开启, 刷新页面状态保持。
		let inspectOn = (() => {
			try { return sessionStorage.getItem("dsh-html-inspector:off") !== "1"; } catch { return true; }
		})();
		const setInspectOn = (on) => {
			inspectOn = on;
			try { sessionStorage.setItem("dsh-html-inspector:off", on ? "0" : "1"); } catch {}
		};

		// /sidebar/html/<sessionId>/<编码路径> → 还原文件绝对路径 (仅用于展示)。
		function decodeSidebarHtmlSrc(src) {
			try {
				const u = new URL(src, window.location.origin);
				if (u.origin !== window.location.origin) return null;
				const m = /^\/sidebar\/html\/[^/]+\/(.*)$/.exec(u.pathname);
				if (!m) return null;
				const segs = m[1].split("/").filter((s) => s !== "").map(decodeURIComponent);
				if (segs.length === 0) return null;
				const joined = segs.join("/");
				// Windows 盘符路径 (C:/...) 与整段编码的绝对路径 (首段 decode 后自带
				// 前导 /) 不再加前导斜杠; UNC 路径的 // 已被折叠, 展示可接受。
				return /^[a-zA-Z]:\//.test(joined) || joined.startsWith("/") ? joined : "/" + joined;
			} catch { return null; }
		}

		// 文件预览注入脚本: 服务端 buildInspectorJS 的客户端精简版 — 悬停高亮 /
		// 点击捕获 / ESC 取消 / 开关消息。无本机链接改写: 预览文档里点相对链接会
		// 整帧导航到 /sidebar/html 原文, load 钩子会再次注入, 选区自动恢复。
		function buildPreviewInspectorJS(realUrl) {
			return '<script data-dsh-html-inspector>var __DSH_REAL=' + JSON.stringify(realUrl) + ';(function(){' +
				'if(window.__dshHtmlInspector)return;window.__dshHtmlInspector=true;' +
				'var ACTIVE=false,HOVER=null;' +
				'var style=document.createElement("style");' +
				'style.textContent=".__dshi_hover{outline:2px solid #4d9fff !important;outline-offset:-2px;box-shadow:0 0 0 2px rgba(77,159,255,.35) !important;cursor:crosshair !important}";' +
				'(document.head||document.documentElement).appendChild(style);' +
				'function describe(el){' +
				'if(!el||el.nodeType!==1)return null;' +
				'var t=el.tagName?el.tagName.toLowerCase():"";' +
				'var parts=[];var n=el;' +
				'while(n&&n.nodeType===1&&n!==document.documentElement){' +
				'var seg=n.tagName.toLowerCase();' +
				'if(n.id){parts.unshift("#"+n.id);break}' +
				'var i=1,sib=n;' +
				'while(sib=sib.previousElementSibling){if(sib.tagName===n.tagName)i++}' +
				'if(i>1||n.nextElementSibling)seg+=":nth-of-type("+i+")";' +
				'parts.unshift(seg);n=n.parentElement}' +
				'if(n&&n.nodeType===1&&parts[0]&&parts[0].charAt(0)!=="#")parts.unshift(n.tagName.toLowerCase());' +
				'var sel=parts.join(" > ");' +
				'var html=el.outerHTML||"";' +
				'if(html.length>4000)html=html.slice(0,4000)+"…";' +
				'return{tag:t,id:el.id||"",classes:Array.prototype.slice.call(el.classList||[]),selector:sel,' +
				'text:(el.innerText||el.textContent||"").trim().slice(0,1200),html:html}}' +
				'function stop(e){e.preventDefault();e.stopPropagation();return false}' +
				'function onOver(e){if(!ACTIVE)return;if(HOVER===e.target)return;' +
				'if(HOVER)HOVER.classList.remove("__dshi_hover");HOVER=e.target;' +
				'if(HOVER)HOVER.classList.add("__dshi_hover")}' +
				'function onOut(e){if(HOVER===e.target){HOVER.classList.remove("__dshi_hover");HOVER=null}}' +
				'function onClick(e){if(!ACTIVE)return;stop(e);var el=e.target;' +
				'if(HOVER){HOVER.classList.remove("__dshi_hover");HOVER=null}' +
				'window.parent.postMessage({source:"dsh-html-inspector",type:"selected",payload:describe(el)},"*")}' +
				'window.addEventListener("message",function(ev){' +
				'var d=ev.data||{};if(d.source!=="dsh-html-inspector")return;' +
				'if(d.type==="inspect"){ACTIVE=!!d.enabled;' +
				'document.body&&document.body.classList.toggle("__dshi_active",ACTIVE);' +
				'if(ACTIVE){document.addEventListener("mouseover",onOver,true);' +
				'document.addEventListener("mouseout",onOut,true);' +
				'document.addEventListener("click",onClick,true)}' +
				'else{document.removeEventListener("mouseover",onOver,true);' +
				'document.removeEventListener("mouseout",onOut,true);' +
				'document.removeEventListener("click",onClick,true);' +
				'if(HOVER){HOVER.classList.remove("__dshi_hover");HOVER=null}}}});' +
				'window.addEventListener("keydown",function(e){' +
				'if(e.key==="Escape"&&ACTIVE){' +
				'window.parent.postMessage({source:"dsh-html-inspector",type:"cancel"},"*")}});' +
				'})();</' + 'script>';
		}

		const previewBusy = new WeakSet();

		// 把一个 /sidebar/html 预览帧换成注入了 inspector 的同内容副本。
		async function replaceFilePreview(frame) {
			if (!PREVIEW_SRC.test(frame.src || "")) return;
			if (frame.dataset.dshiPreview === "1" || previewBusy.has(frame)) return;
			previewBusy.add(frame);
			try {
				// 帧内可能已导航 (点相对链接), src 属性过时: 同源可读时优先用真实 location。
				let src = frame.src;
				try {
					const cur = frame.contentWindow.location.href;
					if (cur && PREVIEW_SRC.test(cur)) src = cur;
				} catch {}
				const resp = await fetch(src, { credentials: "include" });
				if (!resp.ok) return;
				if (!frame.isConnected || (frame.src !== src && !PREVIEW_SRC.test(frame.contentWindow?.location?.href || ""))) return; // 帧已被换走/卸载
				let text = await resp.text();
				// <base> 指回同目录: 相对资源继续走 /sidebar/html 路由。
				const baseTag = '<base href="' + src.replace(/[^/]*$/, "") + '">';
				if (!/<base\s/i.test(text)) {
					if (/<head\b[^>]*>/i.test(text)) {
						text = text.replace(/<head\b[^>]*>/i, (m) => m + baseTag);
					} else {
						const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
						text = doctype ? text.slice(0, doctype[0].length) + baseTag + text.slice(doctype[0].length) : baseTag + text;
					}
				}
				const scriptTag = buildPreviewInspectorJS(src);
				if (text.includes("</body>")) {
					text = text.replace("</body>", scriptTag + "</body>");
				} else {
					text += scriptTag;
				}
				// 保留 React 原本的 sandbox 属性: 副本继续是 opaque origin, 与原预览
				// 安全姿态一致 (页面脚本碰不到 GUI)。相对资源经 <base> 变成绝对 URL,
				// 以 no-cors 经典加载 — /sidebar/html 路由不鉴权, 可达; postMessage
				// 不受沙箱限制, 直达宿主。
				frame.dataset.dshiPreview = "1";
				frame.srcdoc = text;
			} catch {}
			finally { previewBusy.delete(frame); }
		}

		// 还原预览帧为原文档 (去掉 srcdoc, 强制回到 src 路由)。
		function restoreFilePreview(frame) {
			if (frame.dataset.dshiPreview !== "1") return;
			delete frame.dataset.dshiPreview;
			frame.removeAttribute("srcdoc");
			try {
				if (frame.contentWindow) frame.contentWindow.location.replace(frame.src);
			} catch {
				const s = frame.src;
				try { frame.src = "about:blank"; } catch {}
				setTimeout(() => { try { frame.src = s; } catch {} }, 0);
			}
		}

		// 按当前开关同步所有 /sidebar/html 预览帧。
		function syncPreviewFrames(enabled) {
			document.querySelectorAll("iframe").forEach((frame) => {
				if (!PREVIEW_SRC.test(frame.src || "")) return;
				if (enabled) replaceFilePreview(frame); else restoreFilePreview(frame);
			});
		}

		// ── 写入当前会话输入框 (与 @-mention 同通道) ──
		function appendDraft(ctx, text) {
			try {
				const sessions = ctx.get("sessions");
				const current = sessions && sessions.list ? sessions.list.getSnapshot().current : undefined;
				if (!current) return false;
				const actx = sessions.scope(current);
				if (actx === undefined) return false;
				const conversation = ctx.get("conversation");
				if (conversation === undefined) return false;
				const input = conversation.input.for(actx);
				const draft = input.state.getSnapshot().draft;
				input.setDraft(draft.trim() === "" ? text : draft + "\n" + text);
				return true;
			} catch (error) {
				console.warn("[dsh-html-inspector] draft insert failed:", error);
				return false;
			}
		}

		// ── 全局: 接收代理页面发出的选区消息 ──
		function setupMessageListener(ctx) {
			window.addEventListener("message", (ev) => {
				const d = ev.data || {};
				// 页面内 ESC → type:"cancel": 同步复位工具栏按钮状态。
				if (d.source === SRC && d.type === "cancel") {
					window.dispatchEvent(new CustomEvent("dsh-html-inspector:deactivated"));
					return;
				}
				if (d.source !== SRC || d.type !== "selected" || !d.payload) return;
				const info = d.payload;
				// 反查消息来源的 iframe, 把代理地址还原成真实 demo 页面地址;
				// 找不到 (直接顶层打开代理页等) 则退回当前页地址。
				const frame = Array.from(document.querySelectorAll("iframe")).find((f) => f.contentWindow === ev.source);
				const isPreview = !!frame && (PREVIEW_SRC.test(frame.src || "") || frame.dataset.dshiPreview === "1");
				let pageUrl = "";
				if (isPreview) {
					// 文件预览: 从帧地址还原文件绝对路径。srcdoc 副本 src 属性仍是
					// /sidebar/html 原地址; 帧内导航后 src 属性过时, 同源可读优先真实 location。
					pageUrl = frame ? decodeSidebarHtmlSrc(frame.src) : null;
					if (frame) {
						try {
							const cur = frame.contentWindow.location.href;
							if (cur && PREVIEW_SRC.test(cur)) pageUrl = decodeSidebarHtmlSrc(cur) || pageUrl;
						} catch {}
					}
					pageUrl = pageUrl || "文件预览";
				} else if (frame) {
					// 代理文档里留了 __DSH_REAL (真实页面地址): 同源帧直接读, 跨域或拿不到再退回 src 解码。
					try { pageUrl = frame.contentWindow.__DSH_REAL || ""; } catch {}
					if (!pageUrl) pageUrl = decodeProxyUrl(frame.src);
				} else {
					pageUrl = window.location.href;
				}
				const lines = [];
				lines.push(isPreview ? "「选中元素」来自文件预览: " + pageUrl : "「选中元素」来自浏览器页签: " + pageUrl);
				if (info.selector) lines.push("定位选择器: " + info.selector);
				if (info.text) lines.push("当前文本: " + String(info.text).slice(0, 300));
				if (info.html) lines.push("当前 HTML:\n" + String(info.html).slice(0, 2000));
				appendDraft(ctx, lines.join("\n"));
				// 通知开关按钮复位 (见 toolbar 注入)
				window.dispatchEvent(new CustomEvent("dsh-html-inspector:deactivated"));
			});
		}

		// ── 浏览器页签工具栏: 注入「选区模式」按钮 (无侵入, 找不到也不报错) ──
		const TOOLBAR_FLAG = "data-dshi-button";
		function setupToolbarButton(ctx) {
			// 选区状态记忆 (inspectOn / setInspectOn) 已提到模块级: 浏览器页签与
			// 文件预览共用同一开关。
			const sendToFrame = (enabled) => {
				// 所有代理 iframe (含隐藏页签里挂着的) 一并同步; 未加载完的帧收到的也是无害 no-op。
				// 判定不能只看 src 属性: load 钩子用 location.replace 把直连帧换到代理文档时,
				// src 属性仍是直连地址, 实际文档才是代理——因此对同源可读的帧按真实 location 判。
				// 文件预览帧 (/sidebar/html, 含 srcdoc 注入副本) 也一并同步。
				document.querySelectorAll("iframe").forEach((frame) => {
					let hit = /\/inspector\/proxy|\/sidebar\/proxy/.test(frame.src || "");
					if (!hit) {
						try { hit = /\/inspector\/proxy|\/sidebar\/proxy/.test(frame.contentWindow.location.href); } catch {}
					}
					if (!hit && (PREVIEW_SRC.test(frame.src || "") || frame.dataset.dshiPreview === "1")) hit = true;
					if (hit && frame.contentWindow) {
						frame.contentWindow.postMessage({ source: SRC, type: "inspect", enabled: !!enabled }, "*");
					}
				});
			};
			window.addEventListener("dsh-html-inspector:deactivated", () => {
				setInspectOn(false);
				syncButton();
				// 预览帧不还原原文 (避免选中瞬间闪一次重载), 只就地停用选区。
				sendToFrame(false);
			});

			function buildButton() {
				// 遍历所有地址栏 (多个工作区/页签的浏览器工具栏可能同时挂在 DOM,
				// 隐藏页签的也算): 每个还没有按钮的地址栏各补一个。
				// 旧实现是全文档单例守卫——第一个地址栏挂上按钮后,其他工作区
				// 的地址栏永远等不到按钮,即「这个工作区有、别的没有」的根因。
				const inputs = document.querySelectorAll('input[placeholder^="输入网址"], input[placeholder^="Enter a URL"]');
				let added = false;
				inputs.forEach((input) => {
					const bar = input.parentElement;
					if (!bar) return;
					// 按栏守卫: 本栏已有按钮则跳过 (按钮是 bar 的子节点,bar 卸载即随之消失)。
					if (bar.querySelector("[" + TOOLBAR_FLAG + "]")) return;
					const btn = document.createElement("button");
					btn.setAttribute(TOOLBAR_FLAG, "");
					btn.type = "button";
					btn.title = "选区模式";
					btn.textContent = "✦";
					btn.style.cssText =
						"border:none;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#888);" +
						"font-size:14px;line-height:1;width:28px;height:28px;border-radius:6px;flex:none;" +
						"display:inline-flex;align-items:center;justify-content:center;";
					btn.addEventListener("click", () => {
						setInspectOn(!inspectOn);
						syncButton();
						sendToFrame(inspectOn);
						// 关闭时把文件预览帧还原为原文档 (srcdoc 副本只在选区开启期间存在)。
						if (!inspectOn) syncPreviewFrames(false);
					});
					// 在「前往」按钮前插入; 无则追加到末尾。0.18.0 兼容: 英文环境 title 为 "Go"。
					const go = bar.querySelector('button[title="前往"], button[aria-label="前往"], button[title="Go"], button[aria-label="Go"]');
					bar.insertBefore(btn, go || null);
					added = true;
				});
				if (added) {
					// 默认开启时让样式立刻反映状态; 有新按钮时顺带给已存在的帧补发状态。
					syncButton();
					if (inspectOn) sendToFrame(true);
				}
			}

			// iframe 每次导航都会被 React 以新 key 重挂载 (0.18.0 navigateTo 递增
			// reloadKey),元素上的 load 监听随旧元素一起销毁——这就是「重新导航后
			// 选区失灵、要再点一次按钮」的原因。改在 document 上捕获所有 load 事件
			// (不随 iframe 元素更替丢失): 代理页面一旦加载完成 (首次挂载/点刷新/
			// 重新导航),自动补发当前开关状态。此监听只注册一次。
			let loadHooked = false;
			function setupFrameReloadHook() {
				if (loadHooked) return;
				loadHooked = true;
				document.addEventListener("load", (ev) => {
					const t = ev.target;
					if (!(t instanceof HTMLIFrameElement)) return;
					const srcAttr = t.src || "";
					// 文件预览帧 (/sidebar/html): 开启选区时换成注入副本; srcdoc 副本
					// 加载完成后补发当前开关状态 (dataset 区分原文档与注入副本, 防循环)。
					// 帧内点相对链接会导航回原文 (未注入副本), 此时也要重新注入。
					if (PREVIEW_SRC.test(srcAttr)) {
						if (t.dataset.dshiPreview === "1" && t.hasAttribute("srcdoc")) {
							if (inspectOn) {
								try { t.contentWindow.postMessage({ source: SRC, type: "inspect", enabled: true }, "*"); } catch {}
							}
						} else if (inspectOn) {
							replaceFilePreview(t);
						}
						return;
					}
					// 读帧当前真实地址: 代理文档与 GUI 同源可读; 直连本机地址跨域会抛错 (置 null)。
					let current = null;
					try { current = t.contentWindow ? t.contentWindow.location.href : null; } catch {}
					if (current !== null && /\/inspector\/proxy|\/sidebar\/proxy/.test(current)) {
						// 代理文档 (首次挂载/刷新/重新导航): 补发当前开关状态, 选区不掉线。
						if (inspectOn) sendToFrame(true);
						return;
					}
					// 非沙箱直连支持: 历史记录里的直连地址、AI 推送的页签等载入的本机地址
					// 没有注入脚本——自动改走代理, 让选区在这些入口同样生效。
					try {
						const u = new URL(srcAttr, window.location.origin);
						if (u.origin === window.location.origin) return; // GUI 自身路由 (编辑器预览等) 不动
						if (u.protocol !== "http:" || !isLoopback(u.hostname)) return;
						t.contentWindow.location.replace(window.location.origin + PROXY_PATH + encodeURIComponent(u.origin + u.pathname + u.search));
					} catch {}
				}, true);
			}

			function syncButton() {
				document.querySelectorAll("[" + TOOLBAR_FLAG + "]").forEach((btn) => {
					btn.style.color = inspectOn ? "#4d9fff" : "var(--dsw-alias-label-secondary,#888)";
					btn.style.background = inspectOn ? "var(--dsw-alias-interactive-bg-hover-accent,rgba(77,159,255,.15))" : "transparent";
				});
			}

			document.querySelectorAll('input[placeholder^="输入网址"], input[placeholder^="Enter a URL"]').forEach(hijackGoButton);
			const mo = new MutationObserver(() => {
				buildButton();
				// 新地址栏随时可能出现 (新建页签/切工作区): 每次都补挂「前往」劫持, 函数自带按栏守卫。
				document.querySelectorAll('input[placeholder^="输入网址"], input[placeholder^="Enter a URL"]').forEach(hijackGoButton);
				// 开启选区时, 新出现的文件预览帧也自动注入。
				if (inspectOn) syncPreviewFrames(true);
			});
			mo.observe(document.body, { childList: true, subtree: true });
			buildButton();
			setupFrameReloadHook();
			// 启动时开关已开启则把已挂载的预览帧立即注入 (MutationObserver 也会补, 双保险)。
			if (inspectOn) syncPreviewFrames(true);
		}

		// ── 地址栏输入: 本机地址自动改走代理 ──
		// 「前往」按钮的 click 与 Enter 键是两条独立路径: React onKeyDown 拦得到
		// 键盘, 拦不到 button click。改写输入值后以 pointer capture 吞掉本次点击,
		// flush 后补发一次点击完成导航。
		function hijackGoButton(input) {
			if (input.parentElement && input.parentElement.querySelector("[data-dshi-gohook]")) return;
			const bar = input.parentElement;
			const go = bar && bar.querySelector('button[title="前往"], button[aria-label="前往"], button[title="Go"], button[aria-label="Go"]');
			if (!go || !bar) return;
			const hook = document.createElement("span");
			hook.setAttribute("data-dshi-gohook", "");
			hook.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
			bar.appendChild(hook);
			go.addEventListener("click", (ev) => {
				const proxied = toProxyUrl(input.value, window.location.origin);
				if (!proxied) return; // 非本机地址 / 已是代理地址: 放行
				ev.preventDefault();
				ev.stopPropagation();
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
				const apply = () => {
					setter.call(input, proxied);
					input.dispatchEvent(new Event("input", { bubbles: true }));
				};
				apply();
				setTimeout(() => {
					apply();
					go.click();
				}, 0);
			}, true);
		}

		function setupAddressRewrite() {
			document.addEventListener("keydown", (ev) => {
				if (ev.key !== "Enter") return;
				if (ev.__dshiReentry) return; // 自己补发的 Enter: 此时值已是代理地址, 放行
				const input = ev.target;
				if (!(input instanceof HTMLInputElement)) return;
				// 0.18.0 起中文 placeholder 为「输入网址，例如 example.com」,英文为「Enter a URL…」
				const ph = input.placeholder || "";
				if (!ph.startsWith("输入网址") && !ph.startsWith("Enter a URL")) return;
				const proxied = toProxyUrl(input.value, window.location.origin);
				if (!proxied) return;
				// 改写输入值为绝对代理地址 (GUI 自身 origin),命中 0.18.0 normalizeBrowserUrl
				// 的 self-origin 放行分支; 历史记录/标签标题都是代理地址, 与内建行为一致。
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
				const apply = () => {
					setter.call(input, proxied);
					input.dispatchEvent(new Event("input", { bubbles: true }));
				};
				// 0.18.0 地址栏是 React 受控输入: onChange 的 setState 在事件派发结束时才
				// flush,其 onKeyDown 在此之前执行,会拿旧 state 导航,本机地址被新沙箱
				// 策略拦截。故拦下本次 Enter,等 flush 完成后再补发一次 Enter。事件派发
				// (含 React 提交)先于宏任务结束,故 setTimeout(0) 必然晚于 flush;不能用
				// rAF——后台/遮挡窗口里 rAF 被节流,回调永不触发。
				// 补发的 Enter 带旗标,自身监听直接放行,防重入。
				ev.preventDefault();
				ev.stopPropagation();
				apply();
				setTimeout(() => {
					apply();
					const again = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
					again.__dshiReentry = true;
					input.dispatchEvent(again);
				}, 0);
			}, true);
		}

		return {
			name: "dsh-html-inspector",
			apply(ctx) {
				setupMessageListener(ctx);
				setupAddressRewrite();
				setupToolbarButton(ctx);
				console.info("[dsh-html-inspector] activated");
			}
		};
	}
});
