// Magpie's catalog supplies provider identity; account quotas never select a model.
export function resolveTarget(modelID, models, accounts, route) {
  const routed = route?.asked === modelID && !route.kind && route.model
  const effective = routed || modelID
  const entry = models.find((model) => model.id === effective)
  if (entry?.owned_by === "group" || effective.startsWith("group/") || !effective.includes("/")) {
    return { pending: true, modelID: effective }
  }
  const provider = entry?.owned_by || accounts
    .map((account) => account.provider)
    .filter((id) => id && effective.startsWith(`${id}/`))
    .sort((a, b) => b.length - a.length)[0] || effective.slice(0, effective.indexOf("/"))
  return {
    provider,
    modelID: effective,
    localID: effective.startsWith(`${provider}/`) ? effective.slice(provider.length + 1) : effective,
  }
}

function inModelSet(ids, model) {
  const selected = model.toLowerCase()
  return ids.some((id) => {
    const candidate = id.toLowerCase()
    if (candidate === selected) return true
    const a = candidate.lastIndexOf("@"), b = selected.lastIndexOf("@")
    return a > 0 && b < 0 && candidate.slice(0, a) === selected ||
      b > 0 && a < 0 && selected.slice(0, b) === candidate
  })
}

export function matchesWindow(window, model) {
  if (window.aside) return false
  if (window.model && !model.toLowerCase().includes(window.model.toLowerCase())) return false
  if (window.models?.length) return inModelSet(window.models, model)
  if (window.notModels?.length) return !inModelSet(window.notModels, model)
  return true
}

export function remainingOf(window) {
  if (!window || window.unlimited) return undefined
  const value = Number.isFinite(window.remaining) ? window.remaining :
    Number.isFinite(window.used) ? 100 - window.used :
    Number.isFinite(window.amount) && window.limit > 0 ? 100 * (1 - window.amount / window.limit) : undefined
  return value === undefined ? undefined : Math.max(0, Math.min(100, value))
}

export function selectedStatus({ modelID, models = [], accounts = [], route, phase, error }) {
  if (!modelID) return { text: "" }
  const target = resolveTarget(modelID, models, accounts, route)
  if (target.pending) return { text: "Magpie · awaiting route" }
  const matching = accounts.filter((account) => account.provider === target.provider)
  const label = matching[0]?.name || target.provider
  const prefix = `Magpie ${label}`
  if (!matching.length) {
    if (error) return { text: `${prefix} · unavailable`, error: true }
    return { text: `${prefix} · ${phase === "loading" ? "…" : "no quota"}` }
  }
  const healthy = matching.filter((account) => !account.error)
  if (!healthy.length) return { text: `${prefix} · unavailable`, error: true }
  const figures = healthy.map((account) => {
    const windows = (account.windows || []).filter((window) => matchesWindow(window, target.localID))
    const values = windows.map(remainingOf).filter((value) => value !== undefined)
    if (values.length) return { remaining: Math.min(...values) }
    if (windows.some((window) => window.unlimited)) return { text: "∞" }
    if (account.balance !== undefined && account.balance !== "") return { text: String(account.balance) }
    const display = windows.find((window) => window.display)?.display
    return { text: display || "no quota" }
  })
  const measured = figures.map((figure) => figure.remaining).filter((value) => value !== undefined)
  let value
  if (measured.length === figures.length) {
    const low = Math.round(Math.min(...measured)), high = Math.round(Math.max(...measured))
    value = low === high ? `${low}%` : `${low}–${high}%`
  } else {
    value = [...new Set(figures.map((figure) => figure.remaining === undefined ? figure.text : `${Math.round(figure.remaining)}%`))].join(" / ")
  }
  const count = healthy.length > 1 ? ` · ${healthy.length} accts` : ""
  const failed = matching.length - healthy.length
  const warning = phase === "stale" || failed > 0 ? " !" : ""
  return { text: `${prefix} ${value}${count}${warning}`, remaining: measured.length ? Math.min(...measured) : undefined }
}
