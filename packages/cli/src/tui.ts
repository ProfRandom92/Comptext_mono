// TUI primitives — ANSI colors, Termux-optimized
// Respects NO_COLOR env var and TERM=dumb

const NO_COLOR = process.env.NO_COLOR === "1" || process.env.TERM === "dumb"
export const W = Math.max(40, Math.min(process.stdout.columns ?? 80, 100))

function esc(code: string) { return NO_COLOR ? "" : `\x1b[${code}m` }
function wrap(open: string, close: string) {
  return (s: string) => NO_COLOR ? s : `\x1b[${open}m${s}\x1b[${close}m`
}

export const c = {
  dim:     wrap("2",  "22"),
  bold:    wrap("1",  "22"),
  red:     wrap("31", "39"),
  green:   wrap("32", "39"),
  yellow:  wrap("33", "39"),
  blue:    wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan:    wrap("36", "39"),
  white:   wrap("37", "39"),
  bgRed:    wrap("41", "49"),
  bgGreen:  wrap("42", "49"),
  bgYellow: wrap("43", "49"),
  bgBlue:   wrap("44", "49"),
  bgCyan:   wrap("46", "49"),
  reset: () => NO_COLOR ? "" : "\x1b[0m",
}

export function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length
}

function padEnd(s: string, len: number): string {
  const vis = visibleLength(s)
  return vis >= len ? s : s + " ".repeat(len - vis)
}

const COLOR_MAP: Record<string, (s: string) => string> = {
  red: c.red, green: c.green, yellow: c.yellow,
  blue: c.blue, magenta: c.magenta, cyan: c.cyan, white: c.white,
}

// ╔═══╗ style header box
export function headerBox(title: string, subtitle?: string, color = "blue"): string {
  const col = COLOR_MAP[color] ?? c.blue
  const inner = W - 4
  const pad = (s: string) => padEnd(s, inner)
  const hline = "═".repeat(W - 2)
  const lines = [
    col("╔" + hline + "╗"),
    col("║ ") + c.bold(pad(title)) + col(" ║"),
  ]
  if (subtitle) lines.push(col("║ ") + c.dim(pad(subtitle)) + col(" ║"))
  lines.push(col("╚" + hline + "╝"))
  return lines.join("\n")
}

// ┌─label─┐ style section box
export function sectionBox(label: string, lines: string[], color = "cyan"): string {
  const col = COLOR_MAP[color] ?? c.cyan
  const inner = W - 4
  const lbl = ` ${label} `
  const lblVisible = visibleLength(lbl)
  const dashes = Math.max(0, W - 2 - lblVisible)
  const dLeft = Math.floor(dashes / 2)
  const dRight = dashes - dLeft
  const top = col("┌" + "─".repeat(dLeft) + lbl + "─".repeat(dRight) + "┐")
  const bottom = col("└" + "─".repeat(W - 2) + "┘")
  // auto-wrap lines that exceed inner width
  const wrapped = lines.flatMap(l => wrapLine(l, inner))
  const body = wrapped.map(l => col("│ ") + padEnd(l, inner) + col(" │"))
  return [top, ...body, bottom].join("\n")
}

// 3-line solid color banner
export function banner(text: string, bgFn: (s: string) => string): string {
  const pad_ = " ".repeat(W)
  const centered = text.length < W - 2
    ? " ".repeat(Math.floor((W - text.length) / 2)) + text + " ".repeat(Math.ceil((W - text.length) / 2))
    : text.slice(0, W)
  return [bgFn(pad_), bgFn(centered), bgFn(pad_)].join("\n")
}

// Progress bar with filled/empty chars
export function progressBar(label: string, pct: number, width = 30): string {
  const filled = Math.round((pct / 100) * width)
  const empty  = width - filled
  const bar = c.green("█".repeat(filled)) + c.dim("░".repeat(empty))
  return `${c.dim(label.padEnd(12))} [${bar}] ${c.bold(pct.toFixed(1) + "%")}`
}

// Key-value aligned line
export function kv(key: string, value: string, keyColor: (s: string) => string = c.dim): string {
  return keyColor(key.padEnd(22)) + value
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Wrap a long string to fit within maxWidth visible chars, returns array of lines
export function wrapLine(s: string, maxWidth: number): string[] {
  const vis = visibleLength(s)
  if (vis <= maxWidth) return [s]
  // Plain text wrap (no mid-ANSI-code split needed for our use)
  const words = s.split(" ")
  const out: string[] = []
  let cur = ""
  for (const w of words) {
    const probe = cur ? cur + " " + w : w
    if (visibleLength(probe) <= maxWidth) { cur = probe }
    else { if (cur) out.push(cur); cur = w }
  }
  if (cur) out.push(cur)
  return out.length ? out : [s.slice(0, maxWidth)]
}

// Badges
const B = (text: string, col: (s: string) => string) => col(`[${text}]`)
export const badge = {
  phi:     () => B("PHI",      c.red),
  scrubbed:() => B("GESCRUBBT",c.green),
  safe:    () => B("SICHER",   c.green),
  ok:      () => B("OK",       c.green),
  fail:    () => B("FEHLER",   c.red),
  warn:    () => B("WARNUNG",  c.yellow),
  dsl:     () => B("DSL",      c.cyan),
  epa:     () => B("ePA",      c.blue),
  emerg:   () => B("NOTFALL",  c.red),
  gdpr:    () => B("DSGVO",    c.green),
  llm:     () => B("LLM",      c.yellow),
}
