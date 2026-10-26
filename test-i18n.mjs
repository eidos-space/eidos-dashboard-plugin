import en from "./locales/en.json" with { type: "json" }
import zh from "./locales/zh-CN.json" with { type: "json" }
export function testI18n(initial = "zh-CN") {
  let locale = initial
  const listeners = new Set()
  return {
    get locale() { return locale },
    t(key, values = {}) {
      const message = (locale.startsWith("zh") ? zh[key] : en[key]) ?? en[key] ?? key
      return message.replace(/\{([\w.-]+)\}/g, (all, name) => Object.hasOwn(values, name) ? String(values[name]) : all)
    },
    onDidChangeLocale(listener) { listeners.add(listener); return { dispose() { listeners.delete(listener) } } },
    setLocale(value) { locale = value; for (const listener of listeners) listener({ locale }) }
  }
}
