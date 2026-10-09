// Shared: find Playwright's headless Chromium (or $CHROME).
import { existsSync, readdirSync } from 'fs'

export function browserPath(): string {
  if (process.env.CHROME) return process.env.CHROME
  const base = `${process.env.HOME}/.cache/ms-playwright`
  const shell = existsSync(base) && readdirSync(base).find(d => d.startsWith('chromium_headless_shell'))
  if (!shell) throw new Error('no headless Chromium: run `bunx playwright install chromium-headless-shell` or set CHROME')
  const dir = `${base}/${shell}`
  const sub = readdirSync(dir).find(d => d.startsWith('chrome-headless-shell'))!
  return `${dir}/${sub}/chrome-headless-shell`
}
