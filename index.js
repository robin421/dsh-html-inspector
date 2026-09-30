// dsh-html-inspector — HTML 选区模式独立插件 (host 端)
// 职责: 提供 /inspector/proxy 路由, 回取本机 (loopback) http 页面并注入选区
// inspector 脚本。浏览器页签 (或任意 iframe) 加载代理地址后, 页面内点选元素
// 会 postMessage 出 {source:'dsh-html-inspector', type:'selected', payload},
// 由 client.js 监听并写入对话输入框。绝不修改磁盘上的任何 demo 文件。

// ── 注入到目标页面的选区 inspector 脚本 ─────────────────────────────
// 在页面自身的 origin 内运行: 悬停高亮 / 点击捕获 / ESC 取消, 通过
// window.parent.postMessage 与宿主 GUI 通信。自包含, 不依赖任何插件。
function buildInspectorJS(guiOrigin, realUrl) {
	return '<script data-dsh-html-inspector>var __DSH_BASE="' + guiOrigin + '";var __DSH_REAL=' + JSON.stringify(realUrl) + ';(function(){' +
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
	// 本机链接改写: 代理文档里的 <a href> 点击会脱离代理 (真实地址无注入脚本,
	// 选区随导航丢失)。导航时把 loopback http 链接改写为代理地址, 永远留在
	// 代理文档内; 非 loopback (外链) 保持原生跳转。
	'document.addEventListener("click",function(e){' +
	'var a=e.target&&e.target.closest?e.target.closest("a"):null;' +
	'if(!a)return;var href=a.getAttribute("href")||"";' +
	'if(!href||href.charAt(0)==="#"||/^(javascript:|mailto:|tel:)/i.test(href))return;' +
	'var u=new URL(href,__DSH_REAL);if(u.protocol!=="http:")return;' +
	'var h=u.hostname;if(h!=="localhost"&&h!=="127.0.0.1"&&!/^127\\.\\d+\\.\\d+\\.\\d+$/.test(h))return;' +
	'e.preventDefault();' +
	'window.location.href=__DSH_BASE+"/inspector/proxy?url="+encodeURIComponent(u.href);' +
	'},true);' +
	'})();</' + 'script>';
}

function isLoopbackHostname(hostname) {
	const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
	if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true;
	const parts = host.split('.');
	return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

export const name = 'dsh-html-inspector';
export const inject = ['webServer'];

export function apply(ctx) {
	const webServer = ctx.webServer;

	ctx.effect(() =>
		webServer.register({
			kind: 'prefix',
			path: '/inspector/proxy',
			handler: async (req, res) => {
				// GUI zishen origin (inject script uses it to build proxy url): derive from request Host header.
				const origin = 'http://' + (req.headers.host || '127.0.0.1:3080');
				if (req.method !== 'GET') {
					res.writeHead(405);
					res.end();
					return;
				}
				try {
					const u = new URL(req.url ?? '/', 'http://dsh.internal');
					const target = u.searchParams.get('url');
					if (!target) {
						res.writeHead(400);
						res.end('missing url');
						return;
					}
					let parsed;
					try {
						parsed = new URL(target);
					} catch {
						res.writeHead(400);
						res.end('bad url');
						return;
					}
					// 安全面: 只代理本机 loopback 的 http 目标 (静态 demo 服务器)。
					if (parsed.protocol !== 'http:' || !isLoopbackHostname(parsed.hostname)) {
						res.writeHead(403);
						res.end('loopback http only');
						return;
					}
					let upstream;
					try {
						upstream = await fetch(parsed.href, { redirect: 'follow', signal: AbortSignal.timeout(8000) });
					} catch (fetchError) {
						res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
						res.end('<html><body style="font-family:sans-serif;padding:40px;color:#666"><h2>无法连接 ' + parsed.host + '</h2><p>本机 ' + (parsed.port || '80') + ' 端口的服务没有响应。请先启动你的 demo 服务器（如 <code>python3 -m http.server 8765</code>），然后刷新本页。</p></body></html>');
						return;
					}
					const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
					const buf = Buffer.from(await upstream.arrayBuffer());
					const isHtml = /text\/html|application\/xhtml\+xml/i.test(type);
					let outBody = buf;
					if (isHtml) {
						let text = buf.toString('utf-8');
						// <base> 指回原地址目录: 相对路径资源 (styles.css / app.js) 自动回源。
						const baseTag = '<base href="' + parsed.origin + parsed.pathname.replace(/[^/]*$/, '') + '">';
						if (text.includes('</body>')) {
							text = text.replace('</body>', buildInspectorJS(origin, parsed.href) + '</body>');
						} else {
							text += buildInspectorJS(origin, parsed.href);
						}
						if (!/<base\s/i.test(text)) {
							if (text.includes('<head>')) {
								text = text.replace('<head>', '<head>' + baseTag);
							} else if (/<head\b[^>]*>/i.test(text)) {
								text = text.replace(/<head\b[^>]*>/i, (m) => m + baseTag);
							} else {
								text = baseTag + text;
							}
						}
						outBody = Buffer.from(text, 'utf-8');
					}
					res.writeHead(200, {
						'content-type': type,
						'cache-control': 'no-cache',
						'x-content-type-options': 'nosniff'
					});
					res.end(outBody);
				} catch (error) {
					try {
						res.writeHead(500, { 'content-type': 'application/json' });
						res.end(JSON.stringify({ ok: false, error: String((error && error.message) || error) }));
					} catch {}
				}
			}
		}),
		'dsh-html-inspector: loopback proxy route'
	);
}
