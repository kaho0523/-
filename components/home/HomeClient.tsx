'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ActionPhase, AlarmState, ScheduleResult, UserSettings } from '@/lib/types'
import {
  DEFAULT_ALARM_STATE,
  DEFAULT_SETTINGS,
  getAlarmState,
  getProfiles,
  getSettings,
  saveAlarmState,
  saveSettings,
} from '@/lib/storage'
import { getCachedTrains, setCachedTrains } from '@/lib/train-cache'
import { calculateSchedule } from '@/lib/calculations'
import { playAlarmPattern, stopAlarm } from '@/lib/alarm'
import { RiskBadge } from './RiskBadge'
import { CountdownTimer } from './CountdownTimer'
import { ActionButtons } from './ActionButtons'

const DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土']

function fmt(date: Date) {
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

export function HomeClient() {
  const [settings, setSettings] = useState<UserSettings | null>(null)
  const [schedule, setSchedule] = useState<ScheduleResult | null>(null)
  const [alarm, setAlarm] = useState<AlarmState>(DEFAULT_ALARM_STATE)
  const [now, setNow] = useState(new Date())
  const [geminiMsg, setGeminiMsg] = useState<string | null>(null)
  const [trainFetching, setTrainFetching] = useState(false)
  const [trainFetchResult, setTrainFetchResult] = useState<string | null>(null)
  const [autoLoaded, setAutoLoaded] = useState<string | null>(null)
  const lastAlarmLevel = useRef<string | null>(null)

  // 初期ロード：今日の曜日に合うプロフィールを自動適用
  useEffect(() => {
    const todayDow = new Date().getDay()
    const profiles = getProfiles()
    const match = profiles.find((p) => (p.settings.weekdays ?? []).includes(todayDow))
    if (match) {
      const merged = { ...DEFAULT_SETTINGS, ...match.settings }
      saveSettings(merged)
      setSettings(merged)
      setAutoLoaded(match.name)
    } else {
      setSettings(getSettings())
    }
    setAlarm(getAlarmState())
  }, [])

  // 毎秒更新
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  // スケジュール再計算 + アラーム判定
  useEffect(() => {
    if (!settings) return
    const result = calculateSchedule(settings, now)
    setSchedule(result)

    if (!settings.alarmEnabled || alarm.phase !== 'SLEEPING') return
    if (alarm.snoozedUntil && new Date(alarm.snoozedUntil) > now) return

    const level = result.riskLevel
    if (level === 'CAUTION' || level === 'WARNING' || level === 'DANGER' || level === 'TOO_LATE') {
      if (lastAlarmLevel.current !== level) {
        lastAlarmLevel.current = level
        playAlarmPattern(level)
        if (settings.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
          new Notification('⏰ 遅刻アラーム', { body: result.alertMessage, icon: '/icon-192.png' })
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, settings])

  // 通知パーミッション要求
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  // AIメッセージ取得
  useEffect(() => {
    if (!schedule || !settings) return
    const fetchGemini = async () => {
      try {
        const prompt = `あなたは遅刻防止アシスタントです。以下の状況を踏まえて、ユーザーに向けた短い日本語メッセージを1文で生成してください。
危険度: ${schedule.riskLevel}
出発まで: ${Math.round(schedule.minutesUntilLeave)}分`
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.message) setGeminiMsg(data.message)
        }
      } catch {
        // 無視
      }
    }
    if (schedule.riskLevel !== 'SAFE') {
      fetchGemini()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.riskLevel])

  const updateAlarm = (next: AlarmState) => {
    setAlarm(next)
    saveAlarmState(next)
  }

  const handleWakeUp = () => {
    stopAlarm()
    lastAlarmLevel.current = null
    updateAlarm({ ...alarm, phase: 'PREPARING', wokenAt: new Date().toISOString(), isActive: false })
  }
  const handleSnooze = () => {
    stopAlarm()
    updateAlarm({
      ...alarm,
      snoozedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      lastSnoozedAt: new Date().toISOString(),
    })
  }
  const handlePrepare = () => {
    updateAlarm({ ...alarm, phase: 'PREPARING', preparingAt: new Date().toISOString() })
  }
  const handleLeave = () => {
    stopAlarm()
    updateAlarm({ ...alarm, phase: 'LEAVING', leftAt: new Date().toISOString() })
  }
  const handleReset = () => {
    stopAlarm()
    lastAlarmLevel.current = null
    updateAlarm({ ...DEFAULT_ALARM_STATE })
  }

  const fetchTodayTrains = async () => {
    if (!settings?.homeStation || !settings?.destinationStation) return

    const transfersKey = JSON.stringify(
      (settings.transfers ?? []).map((t) => ({ station: t.station, transferMinutes: t.transferMinutes }))
    )

    const cached = getCachedTrains(settings.homeStation, settings.destinationStation, transfersKey, settings.arrivalTime)
    if (cached) {
      const updated = { ...settings, trainTimes: cached.trains }
      saveSettings(updated)
      setSettings(updated)
      setTrainFetchResult(`✅ ${cached.trains.length}本（キャッシュ）`)
      return
    }

    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), 60_000)

    setTrainFetching(true)
    setTrainFetchResult(null)
    try {
      const params = new URLSearchParams({
        homeStation: settings.homeStation,
        destinationStation: settings.destinationStation,
        arrivalTime: settings.arrivalTime,
        transfers: transfersKey,
        walkFromStation: String(settings.walkFromStation),
        bufferTime: String(settings.bufferTime),
        journeyTime: String(settings.journeyTime),
      })
      const res = await fetch(`/api/trains?${params}`, { signal: abort.signal })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok || !data.trains || data.trains.length === 0) {
        setTrainFetchResult(`取得失敗: ${data.error ?? '不明なエラー'}`)
      } else {
        setCachedTrains(settings.homeStation, settings.destinationStation, transfersKey, settings.arrivalTime, {
          trains: data.trains,
          windowStart: data.windowStart,
          windowEnd: data.windowEnd,
          model: data.model,
        })
        const updated = { ...settings, trainTimes: data.trains }
        saveSettings(updated)
        setSettings(updated)
        setTrainFetchResult(`✅ ${data.trains.length}本取得（${data.windowStart}〜${data.windowEnd}）`)
      }
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') {
        setTrainFetchResult('タイムアウト（60秒）。設定画面で手動入力してください。')
      } else {
        setTrainFetchResult(`通信エラー: ${String(e)}`)
      }
    } finally {
      setTrainFetching(false)
    }
  }

  if (!settings) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">読み込み中…</div>
  }

  const hasSettings = settings.arrivalTime && (settings.trainTimes ?? []).length > 0
  const weekdayLabel = (settings.weekdays ?? []).length > 0
    ? (settings.weekdays ?? []).sort().map((d) => DOW_LABELS[d]).join('・') + '曜日'
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <h1 className="text-base font-bold text-gray-900">⏰ 遅刻防止アラーム</h1>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="text-xs text-gray-400 border border-gray-200 px-2 py-1 rounded-lg"
            >
              リセット
            </button>
            <Link
              href="/settings"
              className="text-sm font-semibold text-blue-600 border border-blue-300 px-3 py-1 rounded-lg"
            >
              設定
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-4 pb-8">
        {/* 現在時刻 */}
        <div className="text-center pt-2">
          <div className="text-6xl font-mono font-black text-gray-900 tabular-nums">
            {now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-sm text-gray-500 mt-1">
            {now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
          </div>
          {autoLoaded && (
            <div className="text-xs text-blue-500 mt-1">「{autoLoaded}」を自動で読み込みました</div>
          )}
        </div>

        {!hasSettings ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
            <div className="text-4xl mb-3">⚙️</div>
            <p className="text-amber-800 font-semibold mb-1">設定が完了していません</p>
            <p className="text-amber-700 text-sm mb-4">電車の時刻・到着希望時間を登録してください</p>
            <Link
              href="/settings"
              className="inline-block bg-blue-600 text-white font-bold px-6 py-3 rounded-xl shadow"
            >
              設定する →
            </Link>
          </div>
        ) : schedule ? (
          <>
            <RiskBadge riskLevel={schedule.riskLevel} message={schedule.alertMessage} />

            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                {weekdayLabel ?? '今日の予定'}
                {settings.destinationStation && ` → ${settings.destinationStation}`}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">起きる時刻</div>
                  <div className="text-3xl font-bold text-gray-900">{fmt(schedule.wakeUpTime)}</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 mb-0.5">家を出る時刻</div>
                  <div className="text-3xl font-bold text-gray-900">{fmt(schedule.leaveHomeTime)}</div>
                </div>
                {schedule.bestTrain ? (
                  <div className="text-center">
                    <div className="text-xs text-gray-400 mb-0.5">乗る電車</div>
                    <div className="text-3xl font-bold text-blue-700">{schedule.bestTrain.time}</div>
                    {schedule.bestTrain.label && (
                      <div className="text-xs text-gray-400">{schedule.bestTrain.label}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-center col-span-1">
                    <div className="text-xs text-red-400">電車未登録</div>
                  </div>
                )}
              </div>
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  到着希望: {settings.arrivalTime} ／ 余裕: {settings.bufferTime}分
                </span>
                <button
                  onClick={fetchTodayTrains}
                  disabled={trainFetching || !settings.homeStation || !settings.destinationStation}
                  className="text-xs text-violet-600 border border-violet-300 px-2 py-1 rounded-lg disabled:opacity-40 flex items-center gap-1"
                >
                  {trainFetching ? (
                    <>
                      <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                      取得中
                    </>
                  ) : (
                    '🤖 今日のダイヤ'
                  )}
                </button>
              </div>
              {trainFetchResult && (
                <div className={`mt-2 text-xs px-2 py-1.5 rounded-lg ${trainFetchResult.startsWith('✅') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {trainFetchResult}
                </div>
              )}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <CountdownTimer targetTime={schedule.leaveHomeTime} label="出発まで" />
            </div>

            {alarm.snoozedUntil && new Date(alarm.snoozedUntil) > now && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-center text-sm text-yellow-700">
                😴 スヌーズ中…{' '}
                <span className="font-bold">
                  {new Date(alarm.snoozedUntil).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </span>{' '}
                に再アラーム
              </div>
            )}

            {geminiMsg && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-sm text-blue-800">
                💬 {geminiMsg}
              </div>
            )}

            <ActionButtons
              phase={alarm.phase}
              onWakeUp={handleWakeUp}
              onSnooze={handleSnooze}
              onPrepare={handlePrepare}
              onLeave={handleLeave}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}
