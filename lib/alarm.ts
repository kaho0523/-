let audioCtx: AudioContext | null = null
let alarmIntervalId: ReturnType<typeof setInterval> | null = null
let alarmRunning = false

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  }
  return audioCtx
}

function beep(freq: number, duration: number, vol: number): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    osc.type = 'sine'
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration / 1000)
    osc.onended = () => resolve()
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function playAlarmPattern(riskLevel: string): Promise<void> {
  try {
    switch (riskLevel) {
      case 'CAUTION':
        await beep(660, 400, 0.3)
        break
      case 'WARNING':
        await beep(880, 200, 0.5)
        await sleep(100)
        await beep(880, 200, 0.5)
        break
      case 'DANGER':
        for (let i = 0; i < 3; i++) {
          await beep(1100, 150, 0.7)
          await sleep(80)
        }
        break
      case 'TOO_LATE':
        for (let i = 0; i < 5; i++) {
          await beep(1320, 100, 0.9)
          await sleep(50)
        }
        break
      default:
        await beep(440, 200, 0.2)
    }
  } catch {
    // AudioContext not available (SSR etc.)
  }
}

export function startRepeatingAlarm(riskLevel: string): void {
  if (alarmRunning) return
  alarmRunning = true
  const interval = riskLevel === 'DANGER' || riskLevel === 'TOO_LATE' ? 15000 : 30000
  playAlarmPattern(riskLevel)
  alarmIntervalId = setInterval(() => playAlarmPattern(riskLevel), interval)
}

export function stopAlarm(): void {
  alarmRunning = false
  if (alarmIntervalId !== null) {
    clearInterval(alarmIntervalId)
    alarmIntervalId = null
  }
}
