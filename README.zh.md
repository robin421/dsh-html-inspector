# dsh-html-inspector

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的 HTML 选区模式插件：开启选区后，在本机 demo 页面上点选任意元素，元素的定位信息 —— CSS 选择器、可见文本、HTML 片段 —— 会自动写入对话输入框，让 AI 精准修改你指向的那个元素。绝不修改磁盘上的任何文件。

## 功能

- **点选定位** —— 悬停时蓝色高亮框跟随光标；点击捕获标签名、id、class、`nth-of-type` CSS 选择器路径、最多 1200 字符可见文本和 4000 字符 outerHTML，写入当前会话输入框。`Esc` 取消选区。
- **浏览器页签支持** —— 在 dsh 浏览器页签地址栏输入本机地址（`localhost` / `127.0.0.1`），插件自动改走注入代理（`/inspector/proxy`），选区跨导航不掉线。
- **文件预览支持** —— 文件树打开的 HTML 预览（`/sidebar/html` 编辑器 iframe）同样可用：开启选区时把预览帧换成注入了 inspector 的同内容副本（补 `<base>` 保相对资源），选中结果带「文件预览」来源标记。
- **选区模式工具栏按钮** —— 若安装了 `dsh-better-sidebar`，自动在其浏览器页签工具栏注入「选区模式」开关（可选；没有它其余功能不受影响）。开关状态按标签页会话记忆，默认开启。
- **仅限本机、只读** —— 代理拒绝一切非本机目标，不写任何文件。

## 安装

```sh
dsh plugin --profile web add github:robin421/dsh-html-inspector
```

收录 [dsh-market](https://github.com/dsh-market/dsh-market#readme) 后也可在 设置 → 插件市场 一键安装。

重启 web GUI（或刷新页面）后，在浏览器页签工具栏找「**选区模式**」按钮，或直接在地址栏输入 `localhost` 地址即可开始。

## 工作原理

- **宿主端**（`index.js`）—— cordis 插件，注册一个路由 `GET /inspector/proxy?url=…`：回取本机 URL，改写同源链接使导航留在代理内，并注入自包含的 inspector 脚本。除 dsh 运行时外零依赖。
- **客户端**（`client.js`）—— 经 dsh client runtime 加载（`dsh.client`，platform `web`）。负责拦截地址栏本机输入、监听代理页面 `postMessage` 出的选区消息、把定位信息写入对话输入框、管理工具栏开关。
- 两端除你自己的机器外不访问任何网络。

## 兼容性

- 适用于 web GUI 以及带 dsh client runtime 的桌面客户端。
- 工具栏按钮需安装 `dsh-better-sidebar` 才会出现；地址栏拦截与文件预览选区模式无需它即可使用。

## 安全

代理只接受本机目标（精确匹配 `localhost`、`127.0.0.0/8`、`::1`、`0.0.0.0`），拒绝其余一切。它只对你要求代理的页面做 GET 请求、注入 inspector 脚本、把结果返回给你自己的 GUI。不存储任何数据，不向任何地方发送任何数据。

## 许可

MIT
