import { NextRequest, NextResponse } from 'next/server'
import { TrainTime } from '@/lib/types'

export const maxDuration = 60

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function toHHMM(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function isValidTime(t: string): boolean {
  return /^\d{2}:\d{2}$/.test(t)
}

// JST の "HH:MM" → UTC の Date（過去なら翌日）
function jstHHMMToUTCDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number)
  const jstDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })
  const [year, month, day] = jstDateStr.split('-').map(Number)
  const utcMs = Date.UTC(year, month - 1, day, h, m, 0) - JST_OFFSET_MS
  const target = new Date(utcMs)
  if (target.getTime() < Date.now()) target.setUTCDate(target.getUTCDate() + 1)
  return target
}

// Yahoo!乗換案内 print ページから出発時刻・到着時刻・路線名を取得
function parsePrintPage(html: string): { deptTime: string; arrTime: string; lineName: string } | null {
  // summary: "07:50<!-- -->発→ ... class="mark">09:06<!-- -->着"
  const deptMatch = html.match(/(\d{1,2}):(\d{2})(?:<!-- -->)?発/)
  const arrMatch = html.match(/class="mark"[^>]*>(\d{1,2}):(\d{2})(?:<!-- -->)?着/)
  if (!deptMatch || !arrMatch) return null

  const deptTime = `${deptMatch[1].padStart(2, '0')}:${deptMatch[2]}`
  const arrTime = `${arrMatch[1].padStart(2, '0')}:${arrMatch[2]}`
  if (!isValidTime(deptTime) || !isValidTime(arrTime)) return null

  // 最初の路線名 (JSON 埋め込み部分を除く)
  const lineMatch = html.match(/(?:ＪＲ|東急|小田急|京王|都営|メトロ|東京メトロ|西武|東武|京急|京成|相鉄|横浜)[^\s<",]{0,40}/)
  const lineName = lineMatch ? lineMatch[0].trim() : ''

  return { deptTime, arrTime, lineName }
}

async function fetchYahooScrape(
  homeStation: string,
  destinationStation: string,
  latestArrivalAtDest: string,
  latestDepartFromHome: string,
): Promise<{ result: { trains: TrainTime[]; windowStart: string; windowEnd: string } | null; error: string }> {
  // 出発上限の2時間前から順方向に検索
  const deadlineDeptDate = jstHHMMToUTCDate(latestDepartFromHome)
  let currentDate = new Date(deadlineDeptDate.getTime() - 2 * 60 * 60 * 1000)

  const trains: TrainTime[] = []
  const seen = new Set<string>()

  for (let attempt = 0; attempt < 15; attempt++) {
    const jstMs = currentDate.getTime() + JST_OFFSET_MS
    const jst = new Date(jstMs)

    const params = new URLSearchParams({
      from: homeStation.trim(),
      to: destinationStation.trim(),
      y: String(jst.getUTCFullYear()),
      m: String(jst.getUTCMonth() + 1).padStart(2, '0'),
      d: String(jst.getUTCDate()).padStart(2, '0'),
      hh: String(jst.getUTCHours()).padStart(2, '0'),
      m1: String(Math.floor(jst.getUTCMinutes() / 10)),
      m2: String(jst.getUTCMinutes() % 10),
      type: '1',  // 出発時刻指定
      ticket: 'ic',
      expkind: '1',
      ws: '2',
      s: '0',
    })

    const url = `https://transit.yahoo.co.jp/search/print?${params}`
    console.log(`[Yahoo] attempt=${attempt} url=${url}`)

    let html = ''
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept-Language': 'ja-JP,ja;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        },
        signal: AbortSignal.timeout(8000),
      })
      html = await res.text()
      if (!res.ok) return { result: null, error: `HTTP ${res.status}` }
    } catch (e) {
      return { result: null, error: String(e) }
    }

    const route = parsePrintPage(html)
    if (!route) break

    const { deptTime, arrTime, lineName } = route
    console.log(`[Yahoo] attempt=${attempt} dept=${deptTime} arr=${arrTime} line=${lineName}`)

    if (seen.has(deptTime)) {
      currentDate = new Date(currentDate.getTime() + 60_000)
      continue
    }

    // 出発上限を超えたら終了
    if (deptTime > latestDepartFromHome) break

    // 到着時刻が間に合う場合のみ追加
    if (arrTime <= latestArrivalAtDest) {
      seen.add(deptTime)
      trains.push({ id: `yahoo-${trains.length}`, time: deptTime, label: lineName })
    }

    // 次のリクエスト: 1分後の出発時刻から検索
    const [dh, dm] = deptTime.split(':').map(Number)
    const deptJstMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), dh, dm, 0)
    currentDate = new Date(deptJstMs - JST_OFFSET_MS + 60_000)
  }

  if (trains.length === 0) return { result: null, error: '電車が見つかりませんでした' }

  const sorted = trains.sort((a, b) => a.time.localeCompare(b.time)).slice(-3)
  return {
    result: { trains: sorted, windowStart: sorted[0].time, windowEnd: sorted[sorted.length - 1].time },
    error: '',
  }
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

  const { result, error } = await fetchYahooScrape(
    homeStation, destinationStation, latestArrivalAtDest, latestDepartFromHome
  )
  if (result) {
    return NextResponse.json({ ...result, model: 'Yahoo!乗換案内' })
  }

  console.error('[Yahoo] 失敗:', error)
  return NextResponse.json({ error: `電車時刻を取得できませんでした: ${error}`, trains: [] }, { status: 503 })
}
