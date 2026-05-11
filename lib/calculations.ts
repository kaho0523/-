import { UserSettings, ScheduleResult, RiskLevel, TrainTime } from './types'

function parseTime(timeStr: string, baseDate?: Date): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = baseDate ? new Date(baseDate) : new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
}

function subtractMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() - minutes * 60000)
}

export function selectBestTrain(settings: UserSettings, now: Date = new Date()): TrainTime | null {
  if (!settings.trainTimes.length) return null

  const sorted = [...settings.trainTimes].sort((a, b) => a.time.localeCompare(b.time))
  const catchableDeadline = new Date(now.getTime() + settings.walkToStation * 60000)
  const catchable = sorted.filter((t) => parseTime(t.time, now) >= catchableDeadline)

  if (catchable.length > 0) return catchable[0]
  return sorted[sorted.length - 1]
}

export function calculateLeaveHomeTime(settings: UserSettings, now: Date = new Date()): Date {
  const bestTrain = selectBestTrain(settings, now)
  if (bestTrain) {
    return subtractMinutes(parseTime(bestTrain.time, now), settings.walkToStation)
  }
  return subtractMinutes(
    parseTime(settings.arrivalTime, now),
    settings.bufferTime + settings.walkFromStation
  )
}

export function calculatePreparationStartTime(settings: UserSettings, now: Date = new Date()): Date {
  return calculateLeaveHomeTime(settings, now)
}

export function calculateWakeUpTime(settings: UserSettings, now: Date = new Date()): Date {
  return subtractMinutes(calculateLeaveHomeTime(settings, now), settings.prepTime)
}

export function calculateRiskLevel(settings: UserSettings, now: Date = new Date()): RiskLevel {
  const leaveHomeTime = calculateLeaveHomeTime(settings, now)
  const wakeUpTime = calculateWakeUpTime(settings, now)
  const minutesUntilLeave = (leaveHomeTime.getTime() - now.getTime()) / 60000
  const minutesUntilWakeUp = (wakeUpTime.getTime() - now.getTime()) / 60000

  if (minutesUntilLeave < 0) return 'TOO_LATE'
  if (minutesUntilLeave <= 10) return 'DANGER'
  if (minutesUntilLeave <= 25) return 'WARNING'
  if (minutesUntilWakeUp <= 20) return 'CAUTION'
  return 'SAFE'
}

export function generateAlertMessage(riskLevel: RiskLevel, minutesUntilLeave: number): string {
  const min = Math.round(Math.abs(minutesUntilLeave))
  switch (riskLevel) {
    case 'SAFE':    return `出発まであと${min}分。まだ余裕あり。`
    case 'CAUTION': return `そろそろ起きる時間です。準備を始めてください。`
    case 'WARNING': return `今すぐ起きてください！あと${min}分で出発です！`
    case 'DANGER':  return `今すぐ出ないと間に合いません！あと${min}分！`
    case 'TOO_LATE':return `このままでは遅刻します。全力で急いでください！`
  }
}

export function calculateSchedule(settings: UserSettings, now: Date = new Date()): ScheduleResult {
  const wakeUpTime = calculateWakeUpTime(settings, now)
  const prepStartTime = calculatePreparationStartTime(settings, now)
  const leaveHomeTime = calculateLeaveHomeTime(settings, now)
  const bestTrain = selectBestTrain(settings, now)
  const riskLevel = calculateRiskLevel(settings, now)
  const minutesUntilLeave = (leaveHomeTime.getTime() - now.getTime()) / 60000

  return {
    wakeUpTime,
    prepStartTime,
    leaveHomeTime,
    bestTrain,
    estimatedArrival: null,
    riskLevel,
    minutesUntilLeave,
    alertMessage: generateAlertMessage(riskLevel, minutesUntilLeave),
    isLate: minutesUntilLeave < 0,
  }
}
