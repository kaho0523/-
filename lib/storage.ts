import { UserSettings, AlarmState } from './types'

const SETTINGS_KEY = 'train-alarm-settings'
const ALARM_STATE_KEY = 'train-alarm-state'
const PROFILES_KEY = 'train-alarm-profiles'

export interface SettingsProfile {
  id: string
  name: string
  settings: UserSettings
  savedAt: string
}

export function getProfiles(): SettingsProfile[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(PROFILES_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveProfile(name: string, settings: UserSettings): SettingsProfile {
  const profiles = getProfiles()
  const profile: SettingsProfile = {
    id: `profile-${Date.now()}`,
    name,
    settings,
    savedAt: new Date().toISOString(),
  }
  localStorage.setItem(PROFILES_KEY, JSON.stringify([...profiles, profile]))
  return profile
}

export function deleteProfile(id: string): void {
  const profiles = getProfiles().filter((p) => p.id !== id)
  localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles))
}

export const DEFAULT_SETTINGS: UserSettings = {
  homeStation: '',
  destinationStation: '',
  arrivalTime: '09:00',
  prepTime: 35,
  walkToStation: 10,
  walkFromStation: 10,
  bufferTime: 10,
  trainTimes: [],
  transfers: [],
  weekdays: [],
  journeyTime: 30,
  notificationsEnabled: true,
  alarmEnabled: true,
}

export const DEFAULT_ALARM_STATE: AlarmState = {
  isActive: false,
  snoozedUntil: null,
  phase: 'SLEEPING',
  lastSnoozedAt: null,
  wokenAt: null,
  preparingAt: null,
  leftAt: null,
}

export function getSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      trainTimes: Array.isArray(parsed.trainTimes) ? parsed.trainTimes : [],
      transfers: Array.isArray(parsed.transfers) ? parsed.transfers : [],
      weekdays: Array.isArray(parsed.weekdays) ? parsed.weekdays : [],
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: UserSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export function getAlarmState(): AlarmState {
  if (typeof window === 'undefined') return DEFAULT_ALARM_STATE
  try {
    const raw = localStorage.getItem(ALARM_STATE_KEY)
    if (!raw) return DEFAULT_ALARM_STATE
    return { ...DEFAULT_ALARM_STATE, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_ALARM_STATE
  }
}

export function saveAlarmState(state: AlarmState): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(ALARM_STATE_KEY, JSON.stringify(state))
}
