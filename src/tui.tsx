import { Plugin } from "@opencode/plugin/tui"
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { selectedStatus, remainingOf } from "./selection.mjs"

type QuotaWindow = {
  unlimited?: boolean
  name?: string
  used?: number
  remaining?: number
  resetsAt?: string | number
  resetSecs?: number
  span?: number
  display?: string
  amount?: number
  limit?: number
  unit?: string
  aside?: boolean
  runsOutAt?: string | number
  runsOut?: number
  model?: string
  models?: string[]
  notModels?: string[]
}

type QuotaReset = {
  count?: number
  until?: string | number
  byWindow?: boolean
  fiveHour?: number
  weekly?: number
  each?: Array<{ until?: string | number }>
}

type QuotaAccount = {
  provider?: string
  name?: string
  kind?: string
  plan?: string
  user?: string
  windows?: QuotaWindow[]
  readAt?: string
  until?: string
  renew?: string
  balance?: string | number
  error?: string
  resets?: QuotaReset
  lastServedAt?: string
  last?: boolean
}

type Phase = "loading" | "ready" | "error" | "stale"

type QuotaState = {
  phase: Phase
  accounts: QuotaAccount[]
  error: string
  updatedAt: number
  refreshing: boolean
  gateway: string
  models: Array<{ id: string; owned_by?: string }>
}

type PanelInput = {
  readonly name: string
  readonly sessionID: string
  readonly width: number
  readonly presentation: "panel" | "fullscreen"
  readonly focused: boolean
  readonly focus: () => void
  readonly close: () => void
  readonly toggleFullscreen: () => void
}

const PANEL = "magpie.quota"
const DEFAULT_GATEWAY = "http://127.0.0.1:3425"
const DEFAULT_REFRESH_MS = 10_000

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function parseTime(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? value : value > 1e9 ? value * 1000 : value
  }
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseTime(Number(trimmed))
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function resolveGateway(options: Readonly<Record<string, any>>): string {
  const raw = String(
    options.gateway ??
      options.url ??
      process.env.MAGPIE_URL ??
      process.env.MAGPIE_ADDR ??
      DEFAULT_GATEWAY,
  ).trim()
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    if (url.hostname === "0.0.0.0" || url.hostname === "[::]") url.hostname = "127.0.0.1"
    return url.toString().replace(/\/+$/, "")
  } catch {
    return withScheme.replace(/\/+$/, "")
  }
}

function resolveRefreshMs(options: Readonly<Record<string, any>>): number {
  const value = numeric(options.refreshMs ?? options.intervalMs ?? DEFAULT_REFRESH_MS)
  return clamp(value ?? DEFAULT_REFRESH_MS, 3_000, 300_000)
}

function normalizeAccounts(payload: unknown): QuotaAccount[] {
  if (Array.isArray(payload)) return payload as QuotaAccount[]
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data
    if (Array.isArray(data)) return data as QuotaAccount[]
  }
  throw new Error("Unexpected Magpie quota response")
}

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000))
  if (minutes < 1) return "now"
  const days = Math.floor(minutes / 1_440)
  const hours = Math.floor((minutes % 1_440) / 60)
  const rest = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(rest).padStart(2, "0")}m`
  return `${rest}m`
}

function resetLabel(window: QuotaWindow): string {
  const resetSecs = numeric(window.resetSecs)
  const target = resetSecs !== undefined ? Date.now() + resetSecs * 1000 : parseTime(window.resetsAt)
  if (target === undefined) return ""
  return `↻${formatDuration(target - Date.now())}`
}

function formatClock(ms: number, seconds = false): string {
  if (!ms) return "--:--"
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
  })
}

function formatDateTime(value: string | number | undefined): string {
  const ms = parseTime(value)
  if (ms === undefined) return ""
  return new Date(ms).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function accountTitle(account: QuotaAccount): string {
  const name = account.name ?? account.provider ?? "Account"
  return account.plan ? `${name} · ${account.plan}` : name
}

function usageColor(theme: any, remaining: number | undefined, stale = false): any {
  if (stale) return theme.text.feedback.warning.base
  if (remaining === undefined) return theme.text.muted
  if (remaining <= 20) return theme.text.feedback.error.base
  if (remaining <= 50) return theme.text.feedback.warning.base
  return theme.text.feedback.success.base
}

function windowSummary(window: QuotaWindow, detailed = false): string {
  const parts: string[] = []
  const remaining = remainingOf(window)
  if (window.unlimited) {
    parts.push("unlimited")
  } else if (remaining !== undefined) {
    parts.push(`${Math.round(remaining)}% left`)
    if (detailed && window.display) parts.push(window.display)
  } else if (window.display) {
    parts.push(window.display)
  } else if (window.amount !== undefined && window.limit !== undefined) {
    parts.push(
      `${window.amount} / ${window.limit}${window.unit ? ` ${window.unit}` : ""}`,
    )
  } else {
    parts.push("no usage")
  }
  const reset = resetLabel(window)
  if (reset) parts.push(reset)
  if (window.aside) parts.push("aside")
  if (detailed && window.runsOut !== undefined && window.runsOutAt !== undefined) {
    parts.push(`${window.runsOut} expiring ${formatDateTime(window.runsOutAt)}`)
  }
  return parts.join(" · ")
}

export default Plugin.define({
  id: "magpie.quota",
  setup(context) {
    const options = context.options ?? {}
    const gateway = resolveGateway(options)
    const refreshMs = resolveRefreshMs(options)
    const token = options.token ? String(options.token) : ""

    const [state, update] = context.storage.memory<QuotaState>("quota", {
      initial: {
        phase: "loading",
        accounts: [],
        error: "",
        updatedAt: 0,
        refreshing: false,
        gateway,
        models: [],
      },
    })

    let stopped = false
    let inflight = false
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setInterval> | undefined

    const refresh = async (manual = false) => {
      if (stopped || inflight) return
      inflight = true
      controller?.abort()
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 8_000)

      update((draft) => {
        draft.refreshing = true
        draft.gateway = gateway
        if (!draft.accounts?.length) draft.phase = "loading"
      })

      try {
        const headers: Record<string, string> = { accept: "application/json" }
        if (token) headers.authorization = `Bearer ${token}`
        const catalog = fetch(`${gateway}/v1/models`, { headers, signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) return
            const payload = await response.json()
            if (!stopped && Array.isArray(payload?.data)) update((draft) => { draft.models = payload.data })
          }).catch(() => {})
        const response = await fetch(`${gateway}/v1/magpie/quotas${manual ? "" : "?kept=1"}`, {
          headers,
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await response.text().catch(() => "")
          throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`)
        }
        const payload = await response.json()
        await catalog
        if (stopped) return
        const accounts = normalizeAccounts(payload)
        update((draft) => {
          draft.phase = "ready"
          draft.accounts = accounts
          draft.error = ""
          draft.updatedAt = Date.now()
          draft.refreshing = false
          draft.gateway = gateway
        })
        if (manual) {
          context.ui.toast.show({ message: "Magpie quota refreshed", variant: "success" })
        }
      } catch (error) {
        if (stopped) return
        const message = error instanceof Error ? error.message : String(error)
        update((draft) => {
          draft.phase = (draft.accounts?.length ?? 0) > 0 ? "stale" : "error"
          draft.error = message
          draft.refreshing = false
          draft.gateway = gateway
        })
        if (manual) {
          context.ui.toast.show({ message: `Magpie quota: ${message}`, variant: "error" })
        }
      } finally {
        clearTimeout(timeout)
        inflight = false
        controller = undefined
      }
    }

    const selected = () => {
      const model = context.ui.model.current()
      if (!model) return undefined
      const provider = context.data.location.provider.list(context.location ?? context.data.location.default())
        ?.find((item) => item.id === model.providerID)
      const baseURL = provider?.settings?.baseURL
      const matchesGateway = typeof baseURL === "string" && baseURL.replace(/\/v1\/?$/, "").replace(/\/$/, "") === gateway
      return model.providerID === "magpie" || matchesGateway ? model : undefined
    }
    const [route, setRoute] = createSignal<any>()
    createEffect(() => {
      const model = selected()
      const page = context.ui.router.current()
      setRoute(undefined)
      if (!model || page.type !== "session") return
      const controller = new AbortController()
      let busy = false
      const readRoute = async () => {
        if (busy) return
        busy = true
        try {
          const headers: Record<string, string> = { accept: "application/json" }
          if (token) headers.authorization = `Bearer ${token}`
          const response = await fetch(`${gateway}/v1/magpie/route?session=${encodeURIComponent(page.sessionID)}`, {
            headers, signal: controller.signal,
          })
          if (!response.ok) { if (!controller.signal.aborted) setRoute(undefined); return }
          const payload = await response.json()
          if (!controller.signal.aborted) setRoute(payload.route)
        } catch { if (!controller.signal.aborted) setRoute(undefined) }
        finally { busy = false }
      }
      void readRoute()
      const poll = setInterval(() => void readRoute(), 2_000)
      onCleanup(() => { clearInterval(poll); controller.abort() })
    })
    const Status = () => {
      const summary = () => selectedStatus({
        modelID: selected()?.modelID, models: state.models ?? [], accounts: state.accounts ?? [],
        route: route(), phase: state.phase, error: state.error,
      })
      const color = () => summary().error ? context.theme.text.feedback.error.base :
        usageColor(context.theme, summary().remaining, state.phase === "stale")
      return <Show when={summary().text}>
        <text fg={color()} wrapMode="none" truncate flexShrink={1} minWidth={0}>{summary().text}</text>
      </Show>
    }

    const QuotaPanel = (props: { panel: PanelInput }) => {
      context.keymap.layer(() => ({
        commands: [
          {
            id: "magpie.quota.refresh",
            title: "Refresh Magpie quota",
            bind: "r",
            run: () => void refresh(true),
          },
          {
            id: "magpie.quota.fullscreen",
            title: "Toggle Magpie quota fullscreen",
            bind: "f",
            run: () => props.panel.toggleFullscreen(),
          },
          {
            id: "magpie.quota.close",
            title: "Close Magpie quota",
            bind: "escape",
            run: () => props.panel.close(),
          },
        ],
      }))

      const wide = () => props.panel.width >= 64
      return (
        <box flexDirection="column" flexGrow={1} minHeight={0} padding={1} gap={1}>
          <box flexDirection="column">
            <text fg={context.theme.text.base}>Magpie quota</text>
            <text fg={context.theme.text.muted}>
              {`${state.gateway || gateway} · every ${Math.round(refreshMs / 1000)}s · ${
                state.refreshing ? "refreshing…" : `updated ${formatClock(state.updatedAt, true)}`
              }${state.phase === "stale" ? " · stale" : ""}`}
            </text>
            <Show when={state.error}>
              <text fg={context.theme.text.feedback.error.base}>{state.error}</text>
            </Show>
          </box>
          <Show when={!(state.accounts?.length) && !state.error}>
            <text fg={context.theme.text.muted}>No quota reported yet.</text>
          </Show>
          <For each={state.accounts ?? []}>
            {(account) => (
              <box flexDirection="column">
                <text fg={context.theme.text.base}>
                  {accountTitle(account)}
                  {account.last ? "  · last used" : ""}
                </text>
                <Show when={account.user}>
                  <text fg={context.theme.text.muted}>{account.user}</text>
                </Show>
                <Show when={account.error}>
                  <text fg={context.theme.text.feedback.error.base}>{account.error}</text>
                </Show>
                <Show when={!account.error && !account.windows?.length}>
                  <text fg={context.theme.text.muted}>No quota window reported.</text>
                </Show>
                <For each={account.windows ?? []}>
                  {(window) => (
                    <text
                      fg={
                        window.aside
                          ? context.theme.text.muted
                          : usageColor(context.theme, remainingOf(window))
                      }
                    >
                      {`${wide() ? "  " : ""}${window.name ?? "quota"} · ${windowSummary(window, true)}`}
                    </text>
                  )}
                </For>
                <Show when={account.balance !== undefined && account.balance !== ""}>
                  <text fg={context.theme.text.muted}>{`Balance ${account.balance}`}</text>
                </Show>
                <Show when={account.resets?.count}>
                  <text fg={context.theme.text.muted}>
                    {`Resets ${account.resets?.count}${
                      account.resets?.until
                        ? ` · next ${formatDateTime(account.resets.until)}`
                        : ""
                    }`}
                  </text>
                </Show>
                <Show when={account.until}>
                  <text fg={context.theme.text.muted}>
                    {`Plan until ${formatDateTime(account.until)}`}
                  </text>
                </Show>
              </box>
            )}
          </For>
          <text fg={context.theme.text.muted}>r refresh · f fullscreen · esc close</text>
        </box>
      )
    }

    if (options.footer !== false) {
      context.ui.slot({ append: "prompt.footer.status", render: () => <Status /> })
      context.ui.slot({ append: "home.footer.status", render: () => <Status /> })
    }

    context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL}>
          <QuotaPanel panel={panel} />
        </Show>
      ),
    })

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "magpie.quota.open",
          title: "Magpie quota",
          description: "Show live Magpie subscription quota",
          group: "Magpie",
          palette: true,
          slash: { name: "quota" },
          run: () => {
            if (!context.ui.panel.open(PANEL)) {
              context.ui.toast.show({
                message: "Open a session first to show the Magpie quota panel",
                variant: "warning",
              })
            }
          },
        },
      ],
    }))

    void refresh()
    timer = setInterval(() => void refresh(), refreshMs)

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      controller?.abort()
    }
  },
})
