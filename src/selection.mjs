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

function windowLabel(window) {
  const name = String(window?.name || "quota").trim()
  return name
    .replace(/^(\d+)\s*hours?$/i, "$1h")
    .replace(/^(\d+)\s*days?$/i, "$1d")
}

function windowFigure(window) {
  const remaining = remainingOf(window)
  if (remaining !== undefined) return { remaining }
  if (window.unlimited) return { text: "∞" }
  if (window.display) return { text: window.display }
  return { text: "no quota" }
}

function formatFigures(figures) {
  const measured = figures.map((figure) => figure.remaining).filter((value) => value !== undefined)
  if (measured.length === figures.length) {
    const low = Math.round(Math.min(...measured)), high = Math.round(Math.max(...measured))
    return { text: low === high ? `${low}%` : `${low}–${high}%`, measured }
  }
  return {
    text: [...new Set(figures.map((figure) => figure.remaining === undefined ? figure.text : `${Math.round(figure.remaining)}%`))].join(" / "),
    measured,
  }
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
  const grouped = new Map()
  for (const account of healthy) {
    const windows = (account.windows || []).filter((window) => matchesWindow(window, target.localID))
    for (const window of windows) {
      const label = windowLabel(window)
      const figures = grouped.get(label) || []
      figures.push(windowFigure(window))
      grouped.set(label, figures)
    }
  }
  let measured = []
  let value
  if (grouped.size) {
    const entries = [...grouped].map(([label, figures]) => {
      const formatted = formatFigures(figures)
      measured = measured.concat(formatted.measured)
      return grouped.size > 1 ? `${label} ${formatted.text}` : formatted.text
    })
    value = entries.join(" · ")
  } else {
    const figures = healthy.map((account) => {
      if (account.balance !== undefined && account.balance !== "") return { text: String(account.balance) }
      return { text: "no quota" }
    })
    const formatted = formatFigures(figures)
    measured = formatted.measured
    value = formatted.text
  }
  const count = healthy.length > 1 ? ` · ${healthy.length} accts` : ""
  const failed = matching.length - healthy.length
  const warning = phase === "stale" || failed > 0 ? " !" : ""
  const separator = grouped.size > 1 ? " · " : " "
  return { text: `${prefix}${separator}${value}${count}${warning}`, remaining: measured.length ? Math.min(...measured) : undefined }
}
