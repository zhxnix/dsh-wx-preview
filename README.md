# DSH WX Preview

`dsh-wx-preview` 是一个可移植的 DSH 插件，用于发现、预编译、打开和调试原生微信小程序项目。它读取用户指定目录中的 `project.config.json` 与 `app.json`，在本机启动浏览器兼容预览运行时，并把预览页放进 DSH 右侧栏。

它不依赖 Passlogy、固定端口、固定项目目录或用户目录；每次打开都使用工具参数传入的项目路径。目标项目源码只读，预览缓存写入独立的 `DSH_WX_PREVIEW_HOME` 目录（默认 `~/.dsh-wx-preview`）。

## 能做什么

- 识别任意原生小程序项目，以及 `miniprogramRoot` 指向的源码目录。
- 预编译页面、分包、组件、`WXML/WXSS/JS/JSON` 和常用 `wx.*` API。
- 在 DSH 右栏启动可交互的本地预览，支持页面切换、返回、刷新和热更新。
- 提供 DSH 工具 `wxpreview_discover`、`wxpreview_precompile`、`wxpreview_open`、`wxpreview_status`、`wxpreview_logs`、`wxpreview_update_identity` 和 `wxpreview_stop`。
- DSH 右栏注释插件存在时，使用共享 `BrowserPanel`，面板类型为 `dsh-wx-preview`，因此网页点选注释、连续多条注释、上下文批注、控制台和 DevTools 能复用同一套体验。
- 预览 DOM 会标注 `data-dsh-source-file`、`data-dsh-source-line` 和 `data-dsh-source-kind="wxml"`，注释插件可以直接把被点元素映射回 WXML 源码。
- 没有注释插件时仍可使用独立 iframe 基础预览，并可手工输入一个 HTTP(S) 预览地址。

预览身份、storage、登录状态和 `wx.getSetting`/`wx.authorize` 结果只是本地 Fixture；插件不会调用真实微信登录、读取微信账号、写入 CloudBase 或修改项目源码。

## 安装和加载

在 DSH 插件市场中搜索 `DSH WX Preview` 即可安装。市场条目来自
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)，并使用本仓库
GitHub Release 的预构建包。也可以直接使用 DSH CLI：

```sh
dsh plugin --profile desktop add \
  https://github.com/zhxnix/dsh-wx-preview/releases/latest/download/dsh-wx-preview.tgz
```

将 `desktop` 换成你实际使用的 profile。安装后重启 DSH，并新建一个 session。
若同时安装 `dsh-sidebar-annotations`，建议先加载注释插件，再加载本插件；本插件会监听共享面板的热更新事件，二者可以独立升级。

不方便使用市场时，可以从 checkout 加载：

```sh
git clone https://github.com/zhxnix/dsh-wx-preview.git
cd dsh-wx-preview
npm install
```

在 DSH profile 的 `cordis.patch.yml` 中加入下面的条目（路径按实际 checkout 位置调整）：

```yaml
- insert:
    - id: dsh-wx-preview
      name: './plugins/dsh-wx-preview/lib/index.js'
```

其中 `package.json` 的 `dsh.bundle.patch` 和仓库根目录的 `dsh.bundle.patch` 是市场安装使用的标准 bundle 入口；手工 checkout 时使用上面的 profile 条目即可。

## DSH 中使用

在会话中直接告诉 DSH：

```text
发现 /Users/me/projects/example-mini
打开 /Users/me/projects/example-mini
```

模型会调用工具：

```text
wxpreview_discover({ projectPath })
wxpreview_precompile({ projectPath, force? })
wxpreview_open({ projectPath, route?, port?, force? })
wxpreview_status({ projectPath?, sessionId? })
wxpreview_logs({ projectPath?, sessionId?, limit? })
wxpreview_update_identity({ projectPath, ...fixturePatch })
wxpreview_stop({ projectPath?, sessionId?, all? })
```

`wxpreview_open` 返回的 `url`/`openInDshSidebar` 是本机回环地址。它会按调用该工具的 DSH 会话保存面板映射；右栏请求 `/dsh-wx-preview/config?sessionId=...` 时只返回当前会话的预览，避免多个会话串项目。

## 命令行

插件也可以脱离 DSH 使用：

```sh
npm install
npx dsh-wx-preview discover ./my-mini-program
npx dsh-wx-preview precompile ./my-mini-program --force
npx dsh-wx-preview serve ./my-mini-program --route pages/index/index
```

`serve` 会启动一个本机服务并持续运行，按 `Ctrl-C` 停止。CLI 和 DSH 使用同一个预览引擎，但 CLI 不会加载 DSH 工具或右栏 UI。

## 项目要求

项目根目录需要包含 `project.config.json` 或 `app.json`。如果存在 `project.config.json`，插件按其中的 `miniprogramRoot` 找到源码目录；源码根目录必须有 `app.json`。`app.json` 至少声明一个 `pages` 页面。原生页面、组件和分包可以使用 `.js`、`.ts`、`.json`、`.wxml`、`.wxss` 和 `.wxs` 文件。

插件会明确拒绝 UniApp、Taro 等非原生项目。WXS、微信插件、Worker、地图、蓝牙、支付、Canvas、真实授权、CloudBase 和完整设备能力会在兼容性报告或运行时日志中提示；它们仍需要微信开发者工具或真机终验。

## 源码位置协议

编译器给每个由 WXML 元素产生的 DOM 元素写入：

```html
data-dsh-source-file="/absolute/path/to/pages/index/index.wxml"
data-dsh-source-line="12"
data-dsh-source-kind="wxml"
```

这是模板元素的实际起始行，不是对 JS 业务逻辑的推断。自定义组件内部元素使用组件自己的 WXML 文件；组件宿主元素使用引用它的页面或组件 WXML 文件。第三方注释/调试插件可以只依赖这三个属性，不需要知道本插件的内部编译结构。

## 最小例子

仓库中的 [`examples/native-mini-miniprogram`](./examples/native-mini-miniprogram) 是一个不依赖业务项目的原生小程序夹具：

```sh
npx dsh-wx-preview discover examples/native-mini-miniprogram
npx dsh-wx-preview precompile examples/native-mini-miniprogram
npx dsh-wx-preview serve examples/native-mini-miniprogram
```

## 开发和验证

```sh
npm install
npm run check
npm run self-test
npm test
```

验证只使用仓库内的最小夹具和临时缓存，不会启动或修改用户项目。

## 许可证和来源

本仓库新增的 DSH 宿主插件、右栏适配、通用会话管理、示例和文档采用 MIT，见 [`LICENSE`](./LICENSE)。

最初的通用预览引擎来自本地 DSH 开发环境中的 `wxpreview` 目录；该目录在抽取时没有根级 LICENSE、NOTICE、版权头或 Git 元数据。公开发布前应向原作者确认该部分的再发布授权；具体情况记录在 [`NOTICE`](./NOTICE)。npm 依赖保留各自许可证，不会被本插件重新授权。
