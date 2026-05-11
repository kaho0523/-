'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserSettings, TrainTime, Transfer } from '@/lib/types'
import { getSettings, saveSettings, DEFAULT_SETTINGS, getProfiles, saveProfile, deleteProfile, SettingsProfile } from '@/lib/storage'
import { getCachedTrains, setCachedTrains, clearCachedTrains } from '@/lib/train-cache'

let idCounter = 0
const genId = () => `id-${Date.now()}-${idCounter++}`

// ────────────────────────────────────────────
// メイン設定コンポーネント
// ────────────────────────────────────────────
export function SettingsClient() {
  const router = useRouter()
  const [form, setForm] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [newTrainTime, setNewTrainTime] = useState('')
  const [newTrainLabel, setNewTrainLabel] = useState('')
  const [saved, setSaved] = useState(false)
  const [profiles, setProfiles] = useState<SettingsProfile[]>([])
  const [profileName, setProfileName] = useState('')
  const [showProfileInput, setShowProfileInput] = useState(false)
  const [fetchingTrains, setFetchingTrains] = useState(false)
  const [fetchedTrains, setFetchedTrains] = useState<TrainTime[] | null>(null)
  const [trainFetchError, setTrainFetchError] = useState<string | null>(null)
  const [fetchMeta, setFetchMeta] = useState<{ windowStart: string; windowEnd: string; model: string; cached?: boolean } | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setForm(getSettings())
    setProfiles(getProfiles())
    return () => { abortRef.current?.abort() }
  }, [])

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) =>
    setForm((prev) => {
      // 到着時間が変わったら電車リストをクリア
      if (key === 'arrivalTime' && value !== prev.arrivalTime) {
        return { ...prev, [key]: value, trainTimes: [] }
      }
      return { ...prev, [key]: value }
    })

  const addTrain = () => {
    if (!newTrainTime.match(/^\d{1,2}:\d{2}$/)) return
    const entry: TrainTime = { id: genId(), time: newTrainTime, label: newTrainLabel || undefined }
    setForm((prev) => ({
      ...prev,
      trainTimes: [...(prev.trainTimes ?? []), entry].sort((a, b) => a.time.localeCompare(b.time)),
    }))
    setNewTrainTime('')
    setNewTrainLabel('')
  }

  const removeTrain = (id: string) =>
    setForm((prev) => ({ ...prev, trainTimes: (prev.trainTimes ?? []).filter((t) => t.id !== id) }))

  const transfersKey = JSON.stringify(
    (form.transfers ?? []).map((t) => ({ station: t.station, transferMinutes: t.transferMinutes }))
  )

  const fetchTrainsFromGemini = async (forceRefresh = false) => {
    // キャッシュ確認（強制更新でなければ）
    if (!forceRefresh) {
      const cached = getCachedTrains(form.homeStation, form.destinationStation, transfersKey, form.arrivalTime)
      if (cached) {
        setFetchedTrains(cached.trains)
        setFetchMeta({ windowStart: cached.windowStart, windowEnd: cached.windowEnd, model: cached.model, cached: true })
        setTrainFetchError(null)
        return
      }
    } else {
      clearCachedTrains(form.homeStation, form.destinationStation, transfersKey, form.arrivalTime)
    }

    abortRef.current?.abort()
    const abort = new AbortController()
    abortRef.current = abort
    const timer = setTimeout(() => abort.abort(), 60_000)

    setFetchingTrains(true)
    setTrainFetchError(null)
    setFetchedTrains(null)
    setFetchMeta(null)
    try {
      const params = new URLSearchParams({
        homeStation: form.homeStation,
        destinationStation: form.destinationStation,
        arrivalTime: form.arrivalTime,
        transfers: transfersKey,
        walkFromStation: String(form.walkFromStation),
        bufferTime: String(form.bufferTime),
        journeyTime: String(form.journeyTime),
      })
      const res = await fetch(`/api/trains?${params}`, { signal: abort.signal })
      clearTimeout(timer)
      const data = await res.json()
      if (!res.ok || data.trains.length === 0) {
        setTrainFetchError(data.error ?? '電車時刻を取得できませんでした')
      } else {
        setFetchedTrains(data.trains)
        setFetchMeta({ windowStart: data.windowStart, windowEnd: data.windowEnd, model: data.model, cached: false })
        // 成功したらキャッシュに保存
        setCachedTrains(form.homeStation, form.destinationStation, transfersKey, form.arrivalTime, {
          trains: data.trains,
          windowStart: data.windowStart,
          windowEnd: data.windowEnd,
          model: data.model,
        })
      }
    } catch (e) {
      clearTimeout(timer)
      if (e instanceof Error && e.name === 'AbortError') {
        setTrainFetchError('タイムアウト（60秒）。乗り換えなしの区間で試すか、手動で時刻を入力してください。')
      } else {
        setTrainFetchError(`通信エラー: ${String(e)}`)
      }
    } finally {
      setFetchingTrains(false)
    }
  }

  const applyFetchedTrains = (replace: boolean) => {
    if (!fetchedTrains) return
    setForm((prev) => {
      const base = replace ? [] : prev.trainTimes
      const seen = new Set<string>()
      const deduped = [...base, ...fetchedTrains].filter((t) => {
        if (seen.has(t.time)) return false
        seen.add(t.time)
        return true
      })
      return { ...prev, trainTimes: deduped.sort((a, b) => a.time.localeCompare(b.time)) }
    })
    setFetchedTrains(null)
    setFetchMeta(null)
  }

  const handleSaveProfile = () => {
    if (!profileName.trim()) return
    const profile = saveProfile(profileName.trim(), form)
    setProfiles((prev) => [...prev, profile])
    setProfileName('')
    setShowProfileInput(false)
  }

  const handleLoadProfile = (profile: SettingsProfile) => {
    const updated = { ...DEFAULT_SETTINGS, ...profile.settings }
    setForm(updated)
    saveSettings(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleDeleteProfile = (id: string) => {
    deleteProfile(id)
    setProfiles((prev) => prev.filter((p) => p.id !== id))
  }

  const handleSave = () => {
    saveSettings(form)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputClass = 'w-full border border-gray-300 rounded-xl px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-400'
  const labelClass = 'block text-sm font-semibold text-gray-600 mb-1'

  return (
    <div className="min-h-screen bg-gray-100">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <button onClick={() => router.push('/')} className="text-blue-600 font-medium text-sm">
            ← 戻る
          </button>
          <h1 className="text-base font-bold text-gray-900">設定</h1>
          <button
            onClick={handleSave}
            className="bg-blue-600 text-white font-bold px-4 py-1.5 rounded-xl text-sm"
          >
            {saved ? '✅ 保存済' : '保存'}
          </button>
        </div>
      </header>

      <div className="max-w-md mx-auto p-4 space-y-4 pb-16">

        {/* ── 保存済みプロフィール ── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">保存済みプロフィール</h2>
          <div className="bg-white rounded-2xl shadow-sm p-4 space-y-3">
            {profiles.length === 0 && !showProfileInput && (
              <p className="text-sm text-gray-400 text-center py-1">まだ保存されていません</p>
            )}
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <button
                  onClick={() => handleLoadProfile(p)}
                  className="flex-1 text-left px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-800 active:bg-gray-100"
                >
                  {p.name}
                  <span className="ml-2 text-xs font-normal text-gray-400">{p.settings.arrivalTime}着</span>
                </button>
                <button
                  onClick={() => handleDeleteProfile(p.id)}
                  className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-400 rounded-xl border border-gray-200"
                >
                  ×
                </button>
              </div>
            ))}
            {showProfileInput ? (
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                  placeholder="例：1限用、バイト用"
                  autoFocus
                />
                <button
                  onClick={handleSaveProfile}
                  disabled={!profileName.trim()}
                  className="px-4 py-2 bg-blue-600 text-white font-bold rounded-xl text-sm disabled:opacity-40"
                >
                  保存
                </button>
                <button
                  onClick={() => { setShowProfileInput(false); setProfileName('') }}
                  className="px-3 py-2 text-gray-400 border border-gray-200 rounded-xl text-sm"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowProfileInput(true)}
                className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-400 font-medium hover:border-blue-300 hover:text-blue-500"
              >
                ＋ 現在の設定を名前をつけて保存
              </button>
            )}
          </div>
        </section>

        {/* ── ルート検索（ジョルダン風） ── */}
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <RouteInput
            homeStation={form.homeStation}
            destinationStation={form.destinationStation}
            transfers={form.transfers ?? []}
            arrivalTime={form.arrivalTime}
            onHomeChange={(v) => set('homeStation', v)}
            onDestChange={(v) => set('destinationStation', v)}
            onTransfersChange={(v) => set('transfers', v)}
            onArrivalTimeChange={(v) => set('arrivalTime', v)}
          />
        </div>

        {/* ── 毎週何曜日 ── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">毎週何曜日</h2>
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs text-gray-400 mb-3">選択した曜日に自動でこの設定が読み込まれます</p>
            <div className="flex gap-2 justify-between">
              {['日', '月', '火', '水', '木', '金', '土'].map((label, i) => {
                const selected = (form.weekdays ?? []).includes(i)
                return (
                  <button
                    key={i}
                    onClick={() => {
                      const current = form.weekdays ?? []
                      set('weekdays', selected ? current.filter((d) => d !== i) : [...current, i])
                    }}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                      selected
                        ? i === 0 ? 'bg-red-500 text-white' : i === 6 ? 'bg-blue-500 text-white' : 'bg-gray-800 text-white'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── 時間設定 ── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">時間設定</h2>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
            {[
              { label: '電車の所要時間', key: 'journeyTime' as const, hint: '出発駅→目的地駅' },
              { label: '準備時間', key: 'prepTime' as const, hint: '起床→出発' },
              { label: '駅まで歩く時間', key: 'walkToStation' as const, hint: '自宅→最寄駅' },
              { label: '目的地駅から歩く時間', key: 'walkFromStation' as const, hint: '目的地駅→目的地' },
              { label: '余裕時間', key: 'bufferTime' as const, hint: '早めに着く余裕' },
            ].map(({ label, key, hint }) => (
              <div key={key} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-800">{label}</div>
                  <div className="text-xs text-gray-400">{hint}</div>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    className="w-14 text-right text-base font-bold text-gray-900 border-b-2 border-gray-300 focus:border-blue-500 focus:outline-none bg-transparent"
                    value={form[key]}
                    min={0}
                    max={120}
                    onChange={(e) => set(key, Number(e.target.value))}
                  />
                  <span className="text-sm text-gray-400">分</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── 電車時刻 ── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">
            電車時刻（自宅駅 出発）
          </h2>
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

            {/* Gemini自動取得 */}
            <div className="p-4 border-b border-gray-100">
              {!form.homeStation || !form.destinationStation ? (
                <p className="text-xs text-gray-400 text-center py-1">
                  出発駅・到着駅を設定すると自動取得できます
                </p>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={() => fetchTrainsFromGemini(false)}
                    disabled={fetchingTrains}
                    className="flex-1 py-3.5 bg-violet-600 text-white font-bold rounded-xl text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {fetchingTrains ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        OpenAIで検索中…
                      </>
                    ) : (
                      '🤖 今日のダイヤをOpenAIで取得'
                    )}
                  </button>
                  <button
                    onClick={() => fetchTrainsFromGemini(true)}
                    disabled={fetchingTrains}
                    className="px-3 py-3.5 bg-gray-200 text-gray-600 font-bold rounded-xl text-xs disabled:opacity-50"
                    title="キャッシュを無視して再取得"
                  >
                    🔄再取得
                  </button>
                </div>
              )}

              {trainFetchError && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                  <span className="font-bold">取得失敗：</span>{trainFetchError}
                </div>
              )}

              {fetchedTrains && fetchedTrains.length > 0 && fetchMeta && (
                <div className="mt-3 bg-violet-50 border border-violet-200 rounded-xl p-3">
                  <div className="text-xs font-bold text-violet-700 mb-1">
                    {fetchMeta.windowStart}〜{fetchMeta.windowEnd} の {fetchedTrains.length}本
                    {fetchMeta.cached && <span className="ml-1 bg-violet-200 text-violet-700 px-1.5 py-0.5 rounded-full text-xs">キャッシュ</span>}
                  </div>
                  <div className="text-xs text-violet-400 mb-3">via {fetchMeta.model}</div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {fetchedTrains.map((t) => (
                      <span key={t.id} className="bg-white border border-violet-200 rounded-lg px-2 py-1 text-sm font-mono">
                        {t.time}
                        {t.label && <span className="text-xs text-gray-400 ml-1">{t.label}</span>}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => applyFetchedTrains(true)} className="flex-1 py-2 bg-violet-600 text-white font-bold rounded-xl text-sm">
                      差し替える
                    </button>
                    <button onClick={() => applyFetchedTrains(false)} className="flex-1 py-2 bg-violet-100 text-violet-700 font-bold rounded-xl text-sm">
                      追加する
                    </button>
                    <button onClick={() => setFetchedTrains(null)} className="px-3 py-2 text-gray-400 rounded-xl text-sm border border-gray-200">
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 登録済みリスト */}
            {(form.trainTimes ?? []).length === 0 && (
              <div className="text-center text-sm text-gray-400 py-4">
                電車の時刻を追加してください
              </div>
            )}
            {(form.trainTimes ?? []).map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-xl text-gray-900">{t.time}</span>
                  {t.label && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{t.label}</span>}
                </div>
                <button onClick={() => removeTrain(t.id)} className="text-gray-300 text-xl px-1">×</button>
              </div>
            ))}

            {/* 手動追加 */}
            <div className="flex gap-2 p-4">
              <input
                type="time"
                className="border border-gray-300 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-400 flex-1"
                value={newTrainTime}
                onChange={(e) => setNewTrainTime(e.target.value)}
              />
              <input
                className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 w-24"
                value={newTrainLabel}
                onChange={(e) => setNewTrainLabel(e.target.value)}
                placeholder="メモ"
              />
              <button onClick={addTrain} className="bg-blue-600 text-white font-bold px-4 rounded-xl text-sm shrink-0">
                追加
              </button>
            </div>
          </div>
        </section>

        {/* ── 通知・アラーム ── */}
        <section>
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2 px-1">通知・アラーム</h2>
          <div className="bg-white rounded-2xl shadow-sm divide-y divide-gray-100">
            {[
              { label: 'ブラウザ通知', key: 'notificationsEnabled' as const },
              { label: 'アラーム音', key: 'alarmEnabled' as const },
            ].map(({ label, key }) => (
              <label key={key} className="flex items-center justify-between px-4 py-4 cursor-pointer">
                <span className="text-sm font-medium text-gray-700">{label}</span>
                <div
                  className={`relative w-12 h-6 rounded-full transition-colors ${form[key] ? 'bg-blue-500' : 'bg-gray-300'}`}
                  onClick={() => set(key, !form[key])}
                >
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form[key] ? 'translate-x-6' : 'translate-x-0.5'}`} />
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* 保存ボタン */}
        <button
          onClick={handleSave}
          className="w-full py-4 bg-orange-500 text-white font-bold text-lg rounded-2xl shadow-lg active:bg-orange-600"
        >
          {saved ? '✅ 保存しました！' : '設定を保存する'}
        </button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// ジョルダン風 ルート入力コンポーネント
// ────────────────────────────────────────────
function RouteInput({
  homeStation,
  destinationStation,
  transfers,
  arrivalTime,
  onHomeChange,
  onDestChange,
  onTransfersChange,
  onArrivalTimeChange,
}: {
  homeStation: string
  destinationStation: string
  transfers: Transfer[]
  arrivalTime: string
  onHomeChange: (v: string) => void
  onDestChange: (v: string) => void
  onTransfersChange: (v: Transfer[]) => void
  onArrivalTimeChange: (v: string) => void
}) {
  const addTransferAt = (index: number) => {
    const next = [...transfers]
    next.splice(index, 0, { id: genId(), station: '', transferMinutes: 5 })
    onTransfersChange(next)
  }

  const updateTransfer = (id: string, patch: Partial<Transfer>) =>
    onTransfersChange(transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const removeTransfer = (id: string) =>
    onTransfersChange(transfers.filter((t) => t.id !== id))

  const swap = () => {
    onHomeChange(destinationStation)
    onDestChange(homeStation)
  }

  return (
    <div>
      {/* 出発 */}
      <div className="flex items-center px-4 py-4 gap-3">
        <Badge color="green" label="出発" />
        <input
          className="flex-1 text-lg font-bold text-gray-900 focus:outline-none placeholder:text-gray-300 placeholder:font-normal"
          value={homeStation}
          onChange={(e) => onHomeChange(e.target.value)}
          placeholder="出発駅"
        />
      </div>

      {/* 経由地リスト */}
      {transfers.map((t, i) => (
        <div key={t.id}>
          {/* ＋挿入ボタン（この経由の前） */}
          <InsertButton onClick={() => addTransferAt(i)} />

          {/* 経由行 */}
          <div className="flex items-center px-4 py-3 gap-3 border-t border-gray-100">
            <Badge color="gray" label="経由" />
            <input
              className="flex-1 min-w-0 text-base font-medium text-gray-900 focus:outline-none placeholder:text-gray-300"
              value={t.station}
              onChange={(e) => updateTransfer(t.id, { station: e.target.value })}
              placeholder="経由駅"
            />
            {/* 乗り換え時間 */}
            <div className="flex items-center gap-1 shrink-0 bg-gray-100 rounded-lg px-2 py-1">
              <span className="text-xs text-gray-500">乗換</span>
              <input
                type="number"
                min={1}
                max={60}
                className="w-8 text-right text-sm font-bold text-gray-700 bg-transparent focus:outline-none"
                value={t.transferMinutes}
                onChange={(e) => updateTransfer(t.id, { transferMinutes: Number(e.target.value) })}
              />
              <span className="text-xs text-gray-500">分</span>
            </div>
            {/* 削除ボタン */}
            <button
              onClick={() => removeTransfer(t.id)}
              className="w-7 h-7 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center text-sm shrink-0"
            >
              ×
            </button>
          </div>
        </div>
      ))}

      {/* ＋経由を追加 */}
      <InsertButton onClick={() => addTransferAt(transfers.length)} label="経由を追加" />

      {/* 到着 */}
      <div className="flex items-center px-4 py-4 gap-3 border-t border-gray-200">
        <Badge color="red" label="到着" />
        <input
          className="flex-1 text-lg font-bold text-gray-900 focus:outline-none placeholder:text-gray-300 placeholder:font-normal"
          value={destinationStation}
          onChange={(e) => onDestChange(e.target.value)}
          placeholder="到着駅"
        />
        {/* 出発↔到着 入れ替え */}
        <button
          onClick={swap}
          className="w-9 h-9 rounded-full border border-gray-300 text-gray-400 flex items-center justify-center text-base shrink-0"
          title="出発↔到着 入れ替え"
        >
          ⇅
        </button>
      </div>

      {/* 到着希望時刻 */}
      <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
        <div className="text-sm font-medium text-gray-600">到着希望</div>
        <input
          type="time"
          className="text-xl font-bold text-gray-900 bg-transparent focus:outline-none"
          value={arrivalTime}
          onChange={(e) => onArrivalTimeChange(e.target.value)}
        />
      </div>
    </div>
  )
}

// ────────── 小コンポーネント ──────────

function Badge({ color, label }: { color: 'green' | 'red' | 'gray'; label: string }) {
  const styles = {
    green: 'bg-green-500 text-white',
    red:   'bg-red-500 text-white',
    gray:  'border-2 border-gray-400 text-gray-500 bg-white',
  }
  return (
    <span className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${styles[color]}`}>
      {label}
    </span>
  )
}

function InsertButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-4 py-2 border-t border-gray-100 text-gray-400 hover:bg-gray-50 active:bg-gray-100"
    >
      <span className="w-10 h-7 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center text-lg font-light shrink-0">
        +
      </span>
      {label && <span className="text-sm">{label}</span>}
    </button>
  )
}
