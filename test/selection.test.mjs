import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveTarget, selectedStatus, matchesWindow } from "../src/selection.mjs"

const models = [
  { id: "codex/gpt", owned_by: "codex" },
  { id: "deepseek/chat", owned_by: "deepseek" },
  { id: "acme-plugin/large", owned_by: "acme-plugin" },
  { id: "group/auto", owned_by: "group" },
  { id: "office/vendor/model", owned_by: "office/vendor" },
]
const accounts = [
  { provider: "codex", name: "Codex", last: true, windows: [{ used: 72 }] },
  { provider: "deepseek", name: "DeepSeek", balance: "¥23.61" },
  { provider: "acme-plugin", name: "Acme", windows: [{ used: 20 }] },
  { provider: "office/vendor", name: "Office", windows: [{ used: 10 }] },
]
const status = (modelID, extra = {}) => selectedStatus({ modelID, models, accounts, phase: "ready", ...extra })

test("selection follows catalog provider, never the globally last-used account", () => {
  assert.equal(status("codex/gpt").text, "Magpie Codex 28%")
  assert.equal(status("deepseek/chat").text, "Magpie DeepSeek ¥23.61")
  assert.equal(status("acme-plugin/large").text, "Magpie Acme 80%")
  assert.equal(status("office/vendor/model").text, "Magpie Office 90%")
  assert.equal(status(undefined).text, "")
  assert.equal(status("unknown/model").text, "Magpie unknown · no quota")
})

test("groups wait for their own session route; stale routes for another selection are ignored", () => {
  assert.equal(status("group/auto").text, "Magpie · awaiting route")
  assert.equal(status("group/auto", { route: { asked: "group/auto", model: "acme-plugin/large" } }).text, "Magpie Acme 80%")
  assert.equal(status("deepseek/chat", { route: { asked: "codex/gpt", model: "codex/gpt" } }).text, "Magpie DeepSeek ¥23.61")
  assert.equal(status("group/auto", { route: { kind: "title", asked: "group/auto", model: "codex/gpt" } }).text, "Magpie · awaiting route")
  assert.equal(status("codex/gpt", { route: { asked: "codex/gpt", model: "acme-plugin/large" } }).text, "Magpie Acme 80%")
  assert.equal(resolveTarget("remote/vendor/model", [], [{ provider: "remote/vendor" }]).provider, "remote/vendor")
})

test("multiple accounts are a range, errors do not become another provider's quota", () => {
  const cards = [...accounts, { provider: "codex", windows: [{ used: 10 }] }, { provider: "codex", error: "Unauthorized" }]
  assert.equal(status("codex/gpt", { accounts: cards }).text, "Magpie Codex 28–90% · 2 accts !")
  assert.equal(status("codex/gpt", { accounts: [{ provider: "codex", error: "Unauthorized" }] }).error, true)
  assert.equal(status("codex/gpt", { phase: "stale" }).text, "Magpie Codex 28% !")
})

test("window scopes follow Magpie word/set/context-size rules, and unlimited is not 0%", () => {
  assert.equal(matchesWindow({ model: "OPUS" }, "claude-opus"), true)
  assert.equal(matchesWindow({ models: ["large@256k"] }, "large"), true)
  assert.equal(matchesWindow({ models: ["large@256k"] }, "large@500k"), false)
  assert.equal(matchesWindow({ notModels: ["large"] }, "large@256k"), false)
  assert.equal(matchesWindow({ aside: true }, "large"), false)
  const cards = [{ provider: "acme-plugin", windows: [{ unlimited: true, remaining: 0 }] }]
  assert.equal(status("acme-plugin/large", { accounts: cards }).text, "Magpie acme-plugin ∞")
})
