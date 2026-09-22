# DSH WX Preview

`dsh-wx-preview` is a portable DSH plugin for discovering, precompiling, opening, and debugging native WeChat Mini Programs. It reads `project.config.json` and `app.json` from the project supplied by the caller, starts a local browser-compatible runtime, and exposes the preview in the DSH right sidebar.

The package has no Passlogy dependency, fixed project path, fixed port, or machine-specific username. Source projects are read-only. Generated preview state is stored below `DSH_WX_PREVIEW_HOME` (by default `~/.dsh-wx-preview`).

It provides the DSH tools `wxpreview_discover`, `wxpreview_precompile`, `wxpreview_open`, `wxpreview_status`, `wxpreview_logs`, `wxpreview_update_identity`, and `wxpreview_stop`. When `dsh-sidebar-annotations` is installed, the panel uses its shared `BrowserPanel` with `panelKind: "dsh-wx-preview"`; element comments, context comments, console inspection, and DevTools can then use the same sidebar workflow as web pages. Without that optional plugin, a basic standalone iframe preview remains available.

Every DOM element rendered from WXML receives `data-dsh-source-file`, `data-dsh-source-line`, and `data-dsh-source-kind="wxml"`, so an annotation plugin can map a selected element directly back to its WXML source.

## Install

Search for `DSH WX Preview` in the DSH Plugin Market. The catalog is maintained by
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin), and the
market installs the prebuilt package from this repository's GitHub Release. The CLI form is:

```sh
dsh plugin --profile desktop add \
  https://github.com/zhxnix/dsh-wx-preview/releases/latest/download/dsh-wx-preview.tgz
```

Replace `desktop` with the profile you use. Restart DSH and open a new session after installing.
The optional annotation plugin can be installed and updated separately.

For a checkout-based install:

```sh
git clone https://github.com/zhxnix/dsh-wx-preview.git
cd dsh-wx-preview
npm install
```

Add this entry to the DSH profile's `cordis.patch.yml`, adjusting the path to the checkout:

```yaml
- insert:
    - id: dsh-wx-preview
      name: './plugins/dsh-wx-preview/lib/index.js'
```

The `dsh.bundle.patch` declaration in `package.json` and the root `dsh.bundle.patch` file are the standard bundle entry used by the market; the profile entry above is the manual checkout path.

## DSH tools

```text
wxpreview_discover({ projectPath, maxDepth? })
wxpreview_precompile({ projectPath, force? })
wxpreview_open({ projectPath, route?, port?, force? })
wxpreview_status({ projectPath?, sessionId? })
wxpreview_logs({ projectPath?, sessionId?, limit? })
wxpreview_update_identity({ projectPath, ...fixturePatch })
wxpreview_stop({ projectPath?, sessionId?, all? })
```

`wxpreview_open` returns a local loopback URL. DSH conversation IDs are used for the sidebar configuration lookup, so two sessions cannot accidentally display each other's project.

## CLI

```sh
npm install
npx dsh-wx-preview discover ./my-mini-program
npx dsh-wx-preview precompile ./my-mini-program --force
npx dsh-wx-preview serve ./my-mini-program --route pages/index/index
```

The CLI shares the preview engine but does not require DSH or the DSH tool runtime.

## Scope and limitations

The project must be a native Mini Program with `app.json`; `project.config.json` may set `miniprogramRoot`. UniApp and Taro projects are rejected explicitly. WXS, plugin components, workers, maps, Bluetooth, payments, Canvas, real authorization, CloudBase, and device-specific behavior remain compatibility warnings or require verification in WeChat DevTools or on a real device.

The local identity and permission values are fixtures. The plugin never performs real WeChat login, reads a WeChat account, writes CloudBase, or edits the target project.

## License and provenance

New DSH integration code, session management, examples, and documentation in this repository are MIT licensed. See [`LICENSE`](./LICENSE).

The initial generic preview engine was extracted from a local `wxpreview` directory. That directory contained no root license, notice, copyright header, or Git metadata at extraction time. Redistribution of that portion must be confirmed with its original author before a public release; the situation is documented in [`NOTICE`](./NOTICE). Dependencies keep their own licenses.
