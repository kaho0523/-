export type RiskLevel = 'SAFE' | 'CAUTION' | 'WARNING' | 'DANGER' | 'TOO_LATE'

export type ActionPhase = 'SLEEPING' | 'PREPARING' | 'LEAVING' | 'DEPARTED'

export interface TrainTime {
  id: string
  time: string // "HH:MM"
  label?: string
}

export interface Transfer {
  id: string
  station: string
  transferMinutes: number
}

export interface UserSettings {
  homeStation: string
  destinationStation: string
  arrivalTime: string // "HH:MM"
  prepTime: number
  walkToStation: number
  walkFromStation: number
  bufferTime: number
  trainTimes: TrainTime[]
  transfers: Transfer[]
  weekdays: number[]
  journeyTime: number // 0=日, 1=月, 2=火, 3=水, 4=木, 5=金, 6=土
  notificationsEnabled: boolean
  alarmEnabled: boolean
}

export interface ScheduleResult {
  wakeUpTime: Date
  prepStartTime: Date
  leaveHomeTime: Date
  bestTrain: TrainTime | null
  estimatedArrival: Date | null
  riskLevel: RiskLevel
  minutesUntilLeave: number
  alertMessage: string
  isLate: boolean
}

export interface AlarmState {
  isActive: boolean
  snoozedUntil: string | null
  phase: ActionPhase
  lastSnoozedAt: string | null
  wokenAt: string | null
  preparingAt: string | null
  leftAt: string | null
}
