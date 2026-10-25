import type { Engine, Register } from 'claude-code'

// the share of a rate-limit window that counts as used up
const LIMIT_PERCENT = 95
// the wait past a reset before the work goes on, in case the reset comes late
const SAFETY_MS = 5 * 60 * 1000
// how often the account's limits are read while the watch is on
const POLL_MS = 60 * 1000
const COMMAND = 'wait-rest'

type Limit = { kind: string; percentUsed: number; resetsAt?: string }
type Hot = { kind: string; percentUsed: number; resetAt: number }

// the windows at the limit whose reset is still ahead: a reading past its reset is stale
const atLimit = (limits: Limit[], now: number): Hot[] =>
  limits.flatMap(l => {
    const resetAt = l.resetsAt === undefined ? NaN : Date.parse(l.resetsAt)
    return l.percentUsed >= LIMIT_PERCENT && resetAt > now ? [{ kind: l.kind, percentUsed: l.percentUsed, resetAt }] : []
  })

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

export const register: Register = on => {
  // /wait-rest turns the watch on for this session, /wait-rest off turns it off
  let isArmed = false
  // the limit is used up: the running turn is cut and tools are refused until the wake
  let isPaused = false
  // the main loop's running turn, the id $.turn.abort needs
  let turnId = ''
  let poll: { cancel: () => void } | undefined
  let wake: { cancel: () => void } | undefined

  const check = ($: Engine, limits: Limit[]) => {
    if (isPaused) return
    const hot = atLimit(limits, Date.now())
    if (hot.length > 0) pause($, hot)
  }

  // every window at the limit must reset: wake once the last of them has, plus the safety wait
  const pause = ($: Engine, hot: Hot[]) => {
    isPaused = true
    const wakeAt = Math.max(...hot.map(h => h.resetAt)) + SAFETY_MS
    const percent = Math.max(...hot.map(h => h.percentUsed))
    if (turnId) void $.turn.abort({ turnId })
    wake?.cancel()
    wake = $.clock.after(wakeAt - Date.now(), () => resume($))
    void $.ui.toast(`הגעת ל-${percent}% מהמגבלה. העבודה מושהית עד ${clockOf(wakeAt)}`)
  }

  const resume = async ($: Engine) => {
    wake = undefined
    if (!isArmed) return
    // the reading kept from before the pause can be older than its window's reset: read the account again
    const { rateLimits } = await $.session.usage()
    const hot = atLimit(rateLimits, Date.now())
    if (hot.length > 0) return pause($, hot)
    isPaused = false
    const text = 'המגבלה התאפסה ועברו 5 דקות מרווח ביטחון. המשך בדיוק מהנקודה שבה עצרת במשימה שעבדת עליה. אם לא נשארה משימה פתוחה, כתוב על כך משפט אחד.'
    void $.ui.toast('המגבלה התאפסה, ממשיכים')
    // a turn running right now takes the message inside it; otherwise the message starts a turn of its own
    if (turnId) {
      const { isDelivered } = await $.session.send({ to: { sessionId: await $.session.id() }, text })
      if (isDelivered) return
    }
    void $.prompt.submit({ text })
  }

  const arm = ($: Engine) => {
    isArmed = true
    poll?.cancel()
    const readLimits = async () => {
      const { rateLimits } = await $.session.usage()
      check($, rateLimits)
    }
    void readLimits()
    poll = $.clock.every(POLL_MS, readLimits)
  }

  const disarm = () => {
    isArmed = false
    poll?.cancel()
    poll = undefined
    wake?.cancel()
    wake = undefined
    isPaused = false
  }

  const describe = async ($: Engine) => {
    if (!isArmed) return 'השעון כבוי. הפעל עם /wait-rest.'
    const { rateLimits } = await $.session.usage()
    const lines = rateLimits.map(l => `${l.kind}: ${l.percentUsed}%`)
    return [
      'השעון פועל.',
      isPaused ? 'העבודה מושהית עד שהמגבלה תתאפס.' : 'העבודה רצה.',
      ...(lines.length > 0 ? lines : ['אין עדיין נתוני מגבלה.']),
    ].join('\n')
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Pauses Claude when a plan limit reaches 95%, and wakes it once the limit resets',
      argumentHint: '[off|status]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      disarm()
      return { text: 'השעון כבוי.' }
    }
    if (arg === 'status') return { text: await describe($) }
    arm($)
    return { text: `השעון פועל. הבדיקה כל דקה, ועצירה ב-${LIMIT_PERCENT}%.` }
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) turnId = e.turnId
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.turnId === turnId) turnId = ''
    return next(e)
  })

  // the engine measured the account again: a window at the limit pauses at once
  on('session.measure', ($, e, next) => {
    if (isArmed) check($, e.rateLimits)
    return next(e)
  })

  // while paused no tool runs, so the model cannot go on with the task
  on('tool.call', ($, e, next) => (isPaused ? { deny: 'המגבלה התמלאה. העבודה מושהית עד שהמגבלה תתאפס' } : next(e)))
}
