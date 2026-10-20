# Magpie quota for OpenCode

OpenCode TUI plugin that shows live [Magpie](https://usemagpie.ai/) quota in the prompt footer and follows the model currently selected in OpenCode.

底部额度跟随 OpenCode 当前选择的模型；每 10 秒读取 Magpie 缓存。

## 功能

- 模型目录来自 Magpie 的 `GET /v1/models`，按 `owned_by` 匹配额度的 `provider`，不内置供应商名单，支持订阅、余额、插件供应商和远程供应商。
- 百分比表示剩余比例；余额保留厂商给出的币种和文字；无限额度显示 `∞`。
- 同一供应商多个正常账号显示剩余范围和账号数，不累加百分比，也不把最近使用的账号称作当前账号。`!` 表示读取失败后保留旧数据，或该供应商有账号报错。
- 路由组及故障转移按当前会话 `GET /v1/magpie/route?session=...` 的实际模型显示。只采用 `asked` 与当前选择相同的主会话路由；尚无路由时显示 `awaiting route`。切换模型后不会沿用其他模型的路由。
- 非 Magpie 供应商隐藏底部额度。名为 `magpie` 的 OpenCode 供应商，以及 baseURL 与本插件网关地址相同的供应商，视为 Magpie 连接。
- **不注册任何侧边栏插槽**，不修改原来的侧边栏插件。
- `/quota` 打开全部账号详情；`r` 主动刷新、`f` 切换全屏、Esc 关闭。

自动轮询使用 `/v1/magpie/quotas?kept=1`，只读 Magpie 已保存的结果；`r` 使用不带 `kept` 的接口请求刷新。界面每 10 秒更新不代表厂商每 10 秒提供一次新数据。

## 安装

需要 OpenCode 2.x，且本机 Magpie 网关正在运行（默认 `http://127.0.0.1:3425`）。

```sh
git clone https://github.com/zxunify/opencode-magpie-quota.git
```

把插件目录加入全局 `~/.config/opencode/cli.json`（Windows 为 `%USERPROFILE%\.config\opencode\cli.json`）：

```json
{
  "plugins": [
    "/absolute/path/to/opencode-magpie-quota"
  ]
}
```

重启 OpenCode。插件是纯源码加载，不需要构建或安装依赖。进入会话后底部会出现 Magpie 额度，输入 `/quota` 查看详情。

### 可选配置

使用对象形式传入插件选项：

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-magpie-quota",
      "options": {
        "gateway": "http://127.0.0.1:3425",
        "refreshMs": 10000
      }
    }
  ]
}
```

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `gateway` | `http://127.0.0.1:3425` | Magpie 网关地址 |
| `refreshMs` | `10000` | 刷新间隔，限制在 3–300 秒 |
| `token` | 空 | 远程网关密钥，可选 |

## 关于 Magpie 插件市场

这是 **OpenCode 的 TUI 插件**，不是 Magpie 的供应商插件。它运行在 OpenCode 进程里，通过 Magpie 的 HTTP 接口读取额度；它不注册 Magpie 的 `auth`、`provider` 或 `usage` 钩子。

因此本仓库使用 `opencode-plugin`、`magpie`、`quota`、`tui` 等 GitHub topics，但**不使用 `magpie-plugin`**。Magpie 的 `magpie-plugin` topic 会把仓库当作 Magpie 插件展示和安装；当前代码没有 Magpie 插件入口，安装后不会工作。如果需要在 Magpie 应用内展示额度，应另做一个 Magpie 页面插件，而不是给这个仓库加错误的 topic。

OpenCode 插件通过 npm 包名分发时，用户才能直接 `opencode plugin add opencode-magpie-quota`；当前仓库只提供 GitHub 源码安装方式，npm 包尚未发布。

## 已知边界

Magpie 公共额度接口没有提供完整的模型窗口限制和实际路由账号标识，因此底部显示对应供应商的账号额度概况。窗口若提供 `model`、`models`、`notModels` 限定，则按 Magpie 的规则过滤；没有这些字段时不猜测模型专属额度。路由不可查询或尚未发生时，不推测路由组将使用哪个成员。

路由列表只认 OpenCode 主会话；标题生成、子代理等 side call 不会覆盖主会话的额度显示。

## 验证

```sh
npm test
```

单元测试覆盖：动态供应商匹配、远程/插件供应商、多账号范围、错误账号、无限额度、路由组等待实际路由、切换模型后忽略旧路由，以及 Magpie 的窗口 `model`/`models`/`notModels` 和 `@size` 规则。另做过真实 TUI 的共存、自动刷新、面板关闭恢复和 Codex → DeepSeek → 非 Magpie → Codex 切换验证。

## 协议参考

- [Magpie 接入应用](https://usemagpie.ai/docs/zh/integrate)
- [Magpie 用量钩子](https://usemagpie.ai/docs/zh/plugins#usage)
- [Magpie 网关参考](https://github.com/yetone/magpie/blob/main/docs/reference.md#connecting-anything-else)
- [OpenCode CLI 插件](https://opencode.ai/v2/docs/build/plugins/cli)

## License

MIT
