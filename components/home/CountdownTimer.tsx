'use client'

import { useEffect, useState } from 'react'

interface Props {
  targetTime: Date
  label: string
  className?: string
}

export function CountdownTimer({ targetTime, label, className = '' }: Props) {
  const [remaining, setRemaining] = useState(0)

  useEffect(() => {
    const update = () => setRemaining(Math.floor((targetTime.getTime() - Date.now()) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [targetTime])

  const neg = remaining < 0
  const abs = Math.abs(remaining)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60

  const formatted = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`

  return (
    <div className={`text-center ${className}`}>
      <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${neg ? 'text-red-500' : 'text-gray-500'}`}>
        {neg ? '⚠️ 遅刻確定' : label}
      </div>
      <div className={`text-5xl font-mono font-black tabular-nums ${neg ? 'text-red-600 opacity-50' : 'text-gray-900'}`}>
        {formatted}
      </div>
    </div>
  )
}
