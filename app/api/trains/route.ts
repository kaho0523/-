import { NextRequest, NextResponse } from 'next/server'
import { TrainTime } from '@/lib/types'

export const maxDuration = 30

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t)
}

function normalizeTime(t: string): string {
  const [h, m] = t.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

// Google Maps Directions API で3本分を順番に取得
async function fetchGoogleMapsTransitWithError(
  homeStation: string,
  destinationStation: string,
  latestArrivalAtDest: string,
  latestDepartFromHome: string,
  apiKey: string
): Promise<{ result: { trains: TrainTime[]; windowStart: string; windowEnd: string } | null; error: string }> {
  const inner = await fetchGoogleMapsTransit(homeStation, destinationStation, latestArrivalAtDest, latestDepartFromHome, apiKey)
  return { result: inner.result, error: inner.error }
}

async function fetchGoogleMapsTransit(
  homeStation: string,
  destinationStation: string,
  latestArrivalAtDest: string,
  latestDepartFromHome: string,
  apiKey: string
): Promise<{ result: { trains: TrainTime[]; windowStart: string; windowEnd: string } | null; error: string }> {
  const [ah, am] = latestArrivalAtDest.split(':').map(Number)
  const baseDate = new Date()
  baseDate.setHours(ah, am, 0, 0)
  // すでに過去の時刻なら翌日として扱う
  if (baseDate.getTime() < Date.now()) {
    baseDate.setDate(baseDate.getDate() + 1)
  }

  const trains: TrainTime[] = []
  const seen = new Set<string>()
  let currentArrivalMs = baseDate.getTime()

  for (let attempt = 0; attempt < 3; attempt++) {
    const arrivalTimestamp = Math.floor(currentArrivalMs / 1000)

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
    url.searchParams.set('origin', homeStation + '駅')
    url.searchParams.set('destination', destinationStation + '駅')
    url.searchParams.set('mode', 'transit')
    url.searchParams.set('transit_mode', 'rail')
    url.searchParams.set('arrival_time', String(arrivalTimestamp))
    url.searchParams.set('language', 'ja')
    url.searchParams.set('key', apiKey)

    let data: {
      status: string
      error_message?: string
      routes?: Array<{
        legs?: Array<{
          arrival_time?: { value: number }
          steps?: Array<{
            travel_mode: string
            transit_details?: {
              departure_time?: { value: number }
              line?: { short_name?: string; name?: string }
            }
          }>
        }>
      }>
    }

    try {
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return { result: null, error: `HTTP ${res.status}` }
      data = await res.json()
    } catch (e) { return { result: null, error: String(e) } }

    if (data.status !== 'OK' || !data.routes?.length) {
      return { result: null, error: `status=${data.status} ${data.error_message ?? ''}` }
    }

    const leg = data.routes[0].legs?.[0]
    if (!leg) break

    const arrivalAtDestTs = leg.arrival_time?.value
    if (!arrivalAtDestTs) break

    // 最初のTRANSITステップの出発時刻 = 出発駅の乗車時刻
    let deptTime: string | null = null
    let lineName = ''
    for (const step of leg.steps ?? []) {
      if (step.travel_mode === 'TRANSIT') {
        const deptTs = step.transit_details?.departure_time?.value
        if (!deptTs) continue
        const d = new Date(deptTs * 1000)
        deptTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        lineName = step.transit_details?.line?.short_name ?? step.transit_details?.line?.name ?? ''
        break
      }
    }

    if (!deptTime || !isValidTime(deptTime) || deptTime > latestDepartFromHome || seen.has(deptTime)) break
    seen.add(deptTime)
    trains.push({ id: `google-${Date.now()}-${attempt}`, time: deptTime, label: lineName })

    // 次のループ: この電車が目的地に着く1分前を上限として再検索 → 1本前の電車が返る
    currentArrivalMs = arrivalAtDestTs * 1000 - 60_000
  }

  if (trains.length === 0) return { result: null, error: '電車が見つかりませんでした' }
  const sorted = trains.sort((a, b) => a.time.localeCompare(b.time)).slice(-3)
  return { result: { trains: sorted, windowStart: sorted[0].time, windowEnd: sorted[sorted.length - 1].time }, error: '' }
}

// gpt-5.4-mini + ウェブ検索で電車時刻を取得
async function fetchOpenAIWebSearch(
  homeStation: string,
  destinationStation: string,
  latestArrivalAtDest: string,
  latestDepartFromHome: string,
  apiKey: string
): Promise<{ trains: TrainTime[]; windowStart: string; windowEnd: string } | null> {
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
  const prompt = `今日（${today}）の${homeStation}駅から${destinationStation}駅への電車の時刻表をウェブで検索してください。
${destinationStation}駅に${latestArrivalAtDest}までに到着できる電車のうち、出発時刻が${latestDepartFromHome}以前でギリギリの3本を、${homeStation}駅の出発時刻で答えてください。

必ず以下のJSON形式だけで回答してください。説明文不要。timeは${homeStation}駅の出発時刻（HH:MM形式）です。
{"trains":[{"time":"09:52","type":"急行"},{"time":"09:40","type":"各停"},{"time":"09:28","type":"各停"}]}`

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-5.4-mini',
        tools: [{ type: 'web_search' }],
        input: prompt,
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null

    const data = await res.json()
    // Responses APIのレスポンス形式: output[].content[].text
    const rawText: string = (data.output ?? [])
      .flatMap((o: { type: string; content?: Array<{ type: string; text?: string }> }) =>
        o.type === 'message' ? (o.content ?? []).filter(c => c.type === 'output_text').map(c => c.text ?? '') : []
      )
      .join('')

    const jsonMatch = rawText.match(/\{[\s\S]*?"trains"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as { trains?: Array<{ time?: string; type?: string }> }
    const trains: TrainTime[] = (parsed.trains ?? [])
      .filter((t) => {
        if (!t.time) return false
        const normalized = normalizeTime(t.time.replace('：', ':'))
        return isValidTime(normalized) && normalized <= latestDepartFromHome
      })
      .map((t, i) => ({
        id: `openai-ws-${Date.now()}-${i}`,
        time: normalizeTime(t.time!.replace('：', ':')),
        label: t.type ?? '',
      }))
      .sort((a, b) => a.time.localeCompare(b.time))
      .slice(-3)

    if (trains.length === 0) return null
    return { trains, windowStart: trains[0].time, windowEnd: trains[trains.length - 1].time }
  } catch { return null }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const homeStation = searchParams.get('homeStation') ?? ''
  const destinationStation = searchParams.get('destinationStation') ?? ''
  const arrivalTime = searchParams.get('arrivalTime') ?? '09:00'
  const walkFromStation = Number(searchParams.get('walkFromStation') ?? '0')
  const bufferTime = Number(searchParams.get('bufferTime') ?? '0')
  const journeyTime = Number(searchParams.get('journeyTime') ?? '0')

  if (!homeStation || !destinationStation) {
    return NextResponse.json({ error: '出発駅・目的地駅が必要です', trains: [] }, { status: 400 })
  }

  const [arrH, arrM] = arrivalTime.split(':').map(Number)
  const arrMin = arrH * 60 + arrM
  const latestArrivalAtDestMin = arrMin - walkFromStation - bufferTime
  const latestDepartFromHomeMin = latestArrivalAtDestMin - journeyTime
  const latestArrivalAtDest = toHHMM(latestArrivalAtDestMin)
  const latestDepartFromHome = toHHMM(latestDepartFromHomeMin)

  // ① Google Maps Directions API（精度高・推奨）
  const googleKey = process.env.GOOGLE_MAPS_API_KEY
  if (googleKey) {
    const { result: googleResult, error: googleError } = await fetchGoogleMapsTransitWithError(
      homeStation, destinationStation, latestArrivalAtDest, latestDepartFromHome, googleKey
    )
    if (googleResult) {
      return NextResponse.json({ ...googleResult, model: 'Google Maps' })
    }
    console.error('[Google Maps] 失敗:', googleError)
  }

  // ② gpt-5.4-mini + ウェブ検索
  const openaiKey = request.headers.get('x-openai-api-key') || process.env.OPEN_AI_KEY
  if (openaiKey) {
    const result = await fetchOpenAIWebSearch(
      homeStation, destinationStation, latestArrivalAtDest, latestDepartFromHome, openaiKey
    )
    if (result) {
      return NextResponse.json({ ...result, model: 'gpt-5.4-mini (ウェブ検索)' })
    }
  }

  return NextResponse.json(
    { error: '電車時刻を取得できませんでした。手動で入力してください。', trains: [] },
    { status: 503 }
  )
}
