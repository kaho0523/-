'use client'

import { ActionPhase } from '@/lib/types'

interface Props {
  phase: ActionPhase
  onWakeUp: () => void
  onSnooze: () => void
  onPrepare: () => void
  onLeave: () => void
}

export function ActionButtons({ phase, onWakeUp, onSnooze, onPrepare, onLeave }: Props) {
  if (phase === 'LEAVING' || phase === 'DEPARTED') {
    return (
      <div className="text-center py-6 bg-green-50 border border-green-200 rounded-2xl">
        <div className="text-3xl mb-2">🚉</div>
        <div className="text-green-700 font-bold text-lg">出発済み！</div>
        <div className="text-green-600 text-sm mt-1">がんばってください！</div>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {phase === 'SLEEPING' && (
        <>
          <button
            onClick={onWakeUp}
            className="w-full py-5 text-xl font-bold bg-blue-600 text-white rounded-2xl shadow-lg active:scale-95 transition-transform"
          >
            ✅ 起きた！
          </button>
          <button
            onClick={onSnooze}
            className="w-full py-4 text-base font-semibold bg-gray-100 text-gray-600 rounded-2xl active:scale-95 transition-transform border border-gray-200"
          >
            😴 あと5分だけ…
          </button>
        </>
      )}
      {(phase === 'SLEEPING' || phase === 'PREPARING') && (
        <button
          onClick={onPrepare}
          className="w-full py-4 text-lg font-bold bg-green-600 text-white rounded-2xl shadow active:scale-95 transition-transform"
        >
          🏃 準備開始
        </button>
      )}
      <button
        onClick={onLeave}
        className="w-full py-5 text-xl font-bold bg-orange-500 text-white rounded-2xl shadow-lg active:scale-95 transition-transform"
      >
        🚉 家を出た！
      </button>
    </div>
  )
}
