import { TrainTime } from './types'

interface CacheEntry {
  trains: TrainTime[]
  fetchedAt: string
  windowStart: string
  windowEnd: string
  model: string
  date: string // YYYY-MM-DD
}

const PREFIX = 'train-cache-'

function cacheKey(home: string, dest: string, transfers: string, arrivalTime: string): string {
  const route = `${home}|${dest}|${transfers}|${arrivalTime}`
  let h = 0
  for (let i = 0; i < route.length; i++) {
    h = Math.imul(31, h) + route.charCodeAt(i)
  }
  return `${PREFIX}${Math.abs(h)}`
}

function today(): string {
  return new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
}

export function getCachedTrains(
  home: string,
  dest: string,
  transfers: string,
  arrivalTime: string
): CacheEntry | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey(home, dest, transfers, arrivalTime))
    if (!raw) return null
    const entry: CacheEntry = JSON.parse(raw)
    // 日をまたいだら無効
    if (entry.date !== today()) return null
    return entry
  } catch {
    return null
  }
}

export function setCachedTrains(
  home: string,
  dest: string,
  transfers: string,
  arrivalTime: string,
  data: Pick<CacheEntry, 'trains' | 'windowStart' | 'windowEnd' | 'model'>
): void {
  if (typeof window === 'undefined') return
  try {
    const entry: CacheEntry = { ...data, fetchedAt: new Date().toISOString(), date: today() }
    localStorage.setItem(cacheKey(home, dest, transfers, arrivalTime), JSON.stringify(entry))
  } catch {}
}

export function clearCachedTrains(home: string, dest: string, transfers: string, arrivalTime: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(cacheKey(home, dest, transfers, arrivalTime))
  } catch {}
}
