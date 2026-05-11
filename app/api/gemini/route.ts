import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-openai-api-key') || process.env.OPEN_AI_KEY
  if (!apiKey) {
    return NextResponse.json({ message: null, error: 'API key not set' }, { status: 503 })
  }
  try {
    const { prompt } = await request.json()
    const res = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ 
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        }),
      }
    )
    if (!res.ok) throw new Error('OpenAI error')
    const data = await res.json()
    const message = data.choices?.[0]?.message?.content ?? null
    return NextResponse.json({ message })
  } catch (e) {
    return NextResponse.json({ message: null, error: String(e) }, { status: 500 })
  }
}
