import { RiskLevel } from '@/lib/types'

const CONFIG: Record<RiskLevel, { label: string; bg: string; text: string; border: string; pulse: boolean }> = {
  SAFE: {
    label: '✅ SAFE　余裕あり',
    bg: 'bg-green-50',
    text: 'text-green-800',
    border: 'border-green-300',
    pulse: false,
  },
  CAUTION: {
    label: '⚠️ CAUTION　そろそろ起きて',
    bg: 'bg-yellow-50',
    text: 'text-yellow-800',
    border: 'border-yellow-400',
    pulse: false,
  },
  WARNING: {
    label: '🔶 WARNING　今すぐ起きて！',
    bg: 'bg-orange-100',
    text: 'text-orange-900',
    border: 'border-orange-500',
    pulse: true,
  },
  DANGER: {
    label: '🚨 DANGER　今すぐ出発！',
    bg: 'bg-red-100',
    text: 'text-red-900',
    border: 'border-red-600',
    pulse: true,
  },
  TOO_LATE: {
    label: '💀 TOO LATE　遅刻確定寸前',
    bg: 'bg-red-900',
    text: 'text-white',
    border: 'border-red-900',
    pulse: true,
  },
}

interface Props {
  riskLevel: RiskLevel
  message: string
}

export function RiskBadge({ riskLevel, message }: Props) {
  const c = CONFIG[riskLevel]
  return (
    <div className={`rounded-2xl border-2 p-4 ${c.bg} ${c.border} ${c.pulse ? 'animate-pulse' : ''}`}>
      <div className={`text-xl font-black ${c.text}`}>{c.label}</div>
      <div className={`mt-1 text-sm font-medium ${c.text} opacity-90`}>{message}</div>
    </div>
  )
}
