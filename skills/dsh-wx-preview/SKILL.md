---
name: dsh-wx-preview
description: Preview and inspect native WeChat Mini Program projects in the DSH sidebar.
---

# dsh-wx-preview

Use this plugin for native WeChat Mini Program source trees. Start with
`wxpreview_discover` when the user gives a parent directory. If exactly one
project is found, call `wxpreview_open`; if there are several, ask for or use
the specific project directory. Use `wxpreview_precompile` when the user asks
for a compatibility report or after source changes. Use `wxpreview_logs` and
`wxpreview_status` to investigate the running preview and `wxpreview_stop` to
release its local server.

The preview identity and permissions are local fixtures. Never describe them
as real WeChat authorization, login, CloudBase data, or device capability.
WXML DOM nodes carry `data-dsh-source-file` and `data-dsh-source-line`; when an
annotation points at a node, use that source location as the first place to
inspect the template.
