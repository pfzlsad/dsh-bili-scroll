/**
 * lib/persona.mjs —— 「它自己的那一份」
 * ============================================================================
 * 为什么要有这个东西（2026-10-21）：
 *   以前它的人设是**一次写死**的（使用者工作区里的 `AGENTS.md`）：只有"该怎么说话"，没有"我是谁"。
 *   于是每一轮都像重新投胎 —— 上一轮真看进去的东西、改过的看法，下次一个字都不记得，
 *   评论只能从视频本身临时找话，最后就是「@某人 这期值得看：…」这种换谁都能写的句子。
 *
 * 规矩（跟 `state.mjs` 一个思路，别破坏）：
 *   1. 档案在**插件家里**（`$DSH_HOME/bili-duty/persona/`），不写使用者工作区 ——
 *      他的 `AGENTS.md` 是他的红线，我们只读；这里写的是**它自己的**东西。
 *   2. 那一轮（headless）的 cwd 就是插件家 ⇒ 它写得了 `persona/*.md`；
 *      目录和空文件都由宿主**预先建好**（沙箱不让它新建目录 ✗）。
 *   3. 宿主不负责"写得好不好"（那是模型的活），只负责**边界**：
 *      开跑前拍快照、跑完校验（太长 / 改太猛 / 写了 @ / 结构被拆）⇒ 不合规就回滚。
 *      这样模型再飘，也飘不出一个能毁掉账号人格的改动 ✓。
 * ============================================================================
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, copyFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/** 档案最多多少字（按字符算，不是字节）—— 超了宿主回滚 */
export const SELF_MAX = 1200
/** 一轮最多改多少行（新增 + 删除 + 改写，按多重集差算）—— 超了宿主回滚 */
const CHANGED_MAX = 10
/** 留几份历史快照 */
const HISTORY_MAX = 10

const SEED_SELF = `# 我（自己维护的，不是简历）

<!-- 每轮最多改 2 处；加一行就删一行；只写真的看过之后才确定的事；不编现实身份 / 经历。 -->

## 吃这一套
-

## 不吃这一套
-

## 最近的看法（最多 5 条，过期的删掉）
-

## 我的毛病
-

## 说话习惯
- 习惯用：
- 不用：
`

const SEED_JOURNAL = `# 观影日记（一轮一行，只写真的看进去的；宿主只把最近几条喂给下一轮）
`

const SEED_SAID = `# 我说过的话（发出去就记一行；下一轮别用同样的开头）
`

const SEED_CHANGELOG = `# 我改过的主意（每次动 SELF.md 就记一行：改了哪句 / 因为哪条 BV / 为什么）
`

export function personaPaths(stateDir) {
  const dir = join(stateDir, 'persona')
  return {
    dir,
    self: join(dir, 'SELF.md'),
    journal: join(dir, 'journal.md'),
    said: join(dir, 'said.md'),
    changelog: join(dir, 'CHANGELOG.md'),
    history: join(dir, '.history'),
  }
}

const readIf = (file) => { try { return readFileSync(file, 'utf8') } catch { return '' } }
const stamp = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 首次运行：建目录 + 铺空档案（**绝不碰 AGENTS.md**） */
export function ensurePersona(stateDir, log = () => {}) {
  const p = personaPaths(stateDir)
  try { mkdirSync(p.history, { recursive: true }) } catch { /* 建不了也别拦着插件加载 */ }
  for (const [file, seed] of [[p.self, SEED_SELF], [p.journal, SEED_JOURNAL], [p.said, SEED_SAID], [p.changelog, SEED_CHANGELOG]]) {
    try {
      if (!existsSync(file)) { writeFileSync(file, seed, 'utf8'); log(`已铺好人格档案：${file}`) }
    } catch (e) { log(`铺 ${file} 失败：${e?.message ?? e}`) }
  }
}

/** 数一下某个文件有多少行非空内容（设置页显示"日记多少行了"） */
export function countLines(file) {
  try { return readFileSync(file, 'utf8').split(/\r?\n/).filter((s) => s.trim()).length } catch { return 0 }
}

/** 取最后 n 行非空内容（日记 / 说过的话都只喂最近几条，别把提示词撑爆；标题行不算） */
export function tailLines(file, n) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))
      .slice(-n)
  } catch { return [] }
}

/** 按字符数（而不是字节）算长度 —— 中文一个字算一个 */
export function charCount(text) {
  return Array.from(String(text || '')).length
}

/** 多重集差：新增 / 删除 / 改写各算一行，用来判"这一轮改得猛不猛" */
function changedLines(before, after) {
  const count = (text) => {
    const m = new Map()
    for (const line of String(text || '').split(/\r?\n/)) {
      const k = line.trim()
      if (!k) continue
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }
  const a = count(before)
  const b = count(after)
  let diff = 0
  for (const [k, n] of a) diff += Math.abs((b.get(k) || 0) - n)
  for (const [k, n] of b) if (!a.has(k)) diff += n
  return diff
}

/** 开跑前拍一张 —— 返回当时的正文（跑完拿它比对 / 回滚） */
export function snapshotSelf(stateDir) {
  const p = personaPaths(stateDir)
  const text = readIf(p.self)
  if (!text) return null
  try {
    mkdirSync(p.history, { recursive: true })
    copyFileSync(p.self, join(p.history, `SELF-${stamp()}.md`))
    // 只留最近 HISTORY_MAX 份，别让快照把家目录撑大
    const files = readdirSync(p.history).filter((n) => /^SELF-.*\.md$/.test(n)).sort()
    for (const n of files.slice(0, Math.max(0, files.length - HISTORY_MAX))) {
      try { unlinkSync(join(p.history, n)) } catch { /* 删不掉就留着 */ }
    }
  } catch { /* 快照失败也不拦着这一轮 —— 顶多少一次后悔药 */ }
  return text
}

/**
 * 跑完校验：只拦"会出事的"，不评价"写得好不好"（那是模型的活）。
 * 不合规 ⇒ 把这一轮写的另存成 rejected-*.md（给人排查用），再把 SELF.md 恢复原样。
 */
export function validateSelfUpdate(stateDir, before) {
  const p = personaPaths(stateDir)
  const after = readIf(p.self)
  if (!after) {
    // 被清空 / 删了 ⇒ 用开跑前那份补回来（宁可回到上一版，也别让它变成没人格）
    if (before) { try { writeFileSync(p.self, before, 'utf8') } catch { /* 写不回去只能靠快照 */ } }
    return { ok: !before, changed: 0, chars: 0, why: before ? '档案被清空了' : '' }
  }
  if (before === null || before === undefined) return { ok: true, changed: 0, chars: charCount(after) }
  if (after === before) return { ok: true, changed: 0, chars: charCount(after) }

  const chars = charCount(after)
  const changed = changedLines(before, after)
  const why = []
  if (chars > SELF_MAX) why.push(`太长（${chars} > ${SELF_MAX} 字）`)
  if (changed > CHANGED_MAX) why.push(`改得太猛（${changed} > ${CHANGED_MAX} 行）`)
  if (/@[\w\u4e00-\u9fa5]/.test(after)) why.push('档案里写了 @')
  // 结构被拆：原来有固定小标题，改完只剩一两个 ⇒ 大概率被整篇重写了
  const heads = (s) => (String(s).match(/^##\s+/gm) || []).length
  if (heads(before) >= 3 && heads(after) < 2) why.push('档案结构被拆了')

  if (!why.length) return { ok: true, changed, chars, after }

  let rejected = ''
  try {
    rejected = join(p.history, `rejected-${stamp()}.md`)
    writeFileSync(rejected, after, 'utf8')
  } catch { rejected = '' }
  try { writeFileSync(p.self, before, 'utf8') } catch { /* 写不回去就只能靠快照了 */ }
  return { ok: false, changed, chars, why: why.join('；'), rejected }
}

/** 回退：找最近一份**跟现在不一样**的快照恢复（跟现在一样的不算一版） */
export function rollbackSelf(stateDir) {
  const p = personaPaths(stateDir)
  const now = readIf(p.self)
  let files = []
  try { files = readdirSync(p.history).filter((n) => /^SELF-.*\.md$/.test(n)).sort().reverse() } catch { /* 没有历史 */ }
  for (const n of files) {
    const text = readIf(join(p.history, n))
    if (!text || text === now) continue
    try {
      snapshotSelf(stateDir)                                     // 先把"现在这版"也留一份，回退本身也能再回退
      writeFileSync(p.self, text, 'utf8')
      return { ok: true, from: n, text }
    } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
  }
  return { ok: false, error: files.length ? '最近的快照跟现在一样，没有可回退的版本' : '还没有历史快照（跑过一轮之后才有）' }
}

/** 重置：回到空白模板（先留一份现在的，免得手滑） */
export function resetSelf(stateDir) {
  const p = personaPaths(stateDir)
  try {
    snapshotSelf(stateDir)
    writeFileSync(p.self, SEED_SELF, 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
}

/**
 * 记一条"我说过的话"（评论全文）。
 * ⚠️ 去重按 `BV + rpid`：同一轮里工具记一次、那一轮自己也写一次，是正常的（两边都可能发生）。
 */
export function appendSaid(stateDir, { bvid, rpid, text }) {
  const p = personaPaths(stateDir)
  const bv = String(bvid || '').trim()
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (!bv || !body) return false
  const id = String(rpid || '').trim() || '-'
  const line = `- ${stamp()} · ${bv} · ${id} · ${body}`
  try {
    const tail = tailLines(p.said, 20)
    if (tail.some((l) => l.includes(`· ${bv} · ${id} ·`))) return false
    writeFileSync(p.said, `${readIf(p.said).replace(/\s*$/, '')}\n${line}\n`, 'utf8')
    return true
  } catch { return false }
}

/** 设置页要用的一份摘要（含正文，别塞进 /status —— 那个 5 秒拉一次） */
export function personaInfo(stateDir) {
  const p = personaPaths(stateDir)
  const text = readIf(p.self)
  let updatedAt = ''
  let snapshots = []
  try { updatedAt = statSync(p.self).mtime.toISOString() } catch { /* 还没有 */ }
  try { snapshots = readdirSync(p.history).filter((n) => /^SELF-.*\.md$/.test(n)).sort().reverse() } catch { /* 还没有 */ }
  return {
    dir: p.dir,
    self: p.self,
    text,
    selfChars: charCount(text),
    selfMax: SELF_MAX,
    updatedAt,
    journalLines: countLines(p.journal),
    saidLines: countLines(p.said),
    snapshots,
    journalTail: tailLines(p.journal, 8).join('\n'),
    saidTail: tailLines(p.said, 5).join('\n'),
    changelogTail: tailLines(p.changelog, 8).join('\n'),
  }
}
