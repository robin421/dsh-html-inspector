# dsh-html-inspector

English | [中文](README.zh.md)

Selection mode for HTML preview and browser tabs in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`): turn it on, click any element in a locally served demo page, and the element's locator — CSS selector, visible text, and an HTML snippet — is written straight into the chat input, so the agent can edit precisely what you pointed at. Nothing on disk is ever modified.

## What you get

- **Click-to-locate** — hover highlights the element under the cursor with a blue outline; click captures tag, id, classes, a `nth-of-type` CSS selector path, up to 1200 chars of visible text, and up to 4000 chars of the element's outer HTML, then writes it into the current conversation's input box. `Esc` cancels.
- **Browser tab support** — type a loopback address (`localhost` / `127.0.0.1`) into a dsh browser tab and the plugin transparently routes it through an injecting proxy (`/inspector/proxy`); selections survive navigation.
- **File preview support** — HTML files opened from the file tree (`/sidebar/html` editor iframe) get the same treatment: the preview frame is swapped for a same-content copy with the inspector injected (`<base>` preserved for relative assets), and selections are tagged with a "file preview" origin marker.
- **Selection mode toolbar button** — injects an on/off toggle into the browser-tab toolbar of `dsh-better-sidebar` when present (optional; everything else works without it). The choice is remembered per tab session; it defaults to on.
- **Loopback only, read-only** — the proxy refuses non-loopback targets and never writes to your files.

## Install

```sh
dsh plugin --profile web add github:robin421/dsh-html-inspector
```

Or one click from [dsh-market](https://github.com/dsh-market/dsh-market#readme) (Settings → Plugin Market) once listed.

Restart the web GUI (or refresh the page), then look for the **selection mode** button in the browser-tab toolbar, or just type a `localhost` URL into a browser tab.

## How it works

- **Host side** (`index.js`) — a cordis plugin that registers one route, `GET /inspector/proxy?url=…`. It fetches the loopback URL, rewrites same-origin links so navigation stays inside the proxy, and injects a self-contained inspector script. No dependencies beyond the dsh runtime.
- **Client side** (`client.js`) — loaded via the dsh client runtime (`dsh.client`, platform `web`). It intercepts loopback address-bar input, listens for `postMessage` selections from proxied pages, writes located info into the chat composer, and manages the toolbar toggle.
- The two halves never talk to the network beyond your own machine.

## Compatibility

- Works with the web GUI and desktop clients that ship the dsh client runtime.
- The toolbar button appears only if `dsh-better-sidebar` is installed; the address-bar interception and file-preview selection mode work regardless.

## Security

The proxy binds to loopback targets only (exact-match `localhost`, `127.0.0.0/8`, `::1`, `0.0.0.0`) and rejects everything else. It performs GET fetches of pages you ask it to proxy, injects the inspector script, and returns the result to your own GUI. It stores nothing and sends nothing anywhere.

## License

MIT
