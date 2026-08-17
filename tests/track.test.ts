import { describe, expect, it } from 'vitest'
import { probeTrack } from '../src/audio/track.ts'

/** fetch の代わり。ステータスと Content-Type だけを返す */
function respondWith(status: number, contentType: string | null): typeof fetch {
  return (async () =>
    new Response(null, {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    })) as unknown as typeof fetch
}

describe('probeTrack', () => {
  it('音声が返ってくれば置かれている', async () => {
    expect(await probeTrack('/a.mp3', respondWith(200, 'audio/mpeg'))).toBe(true)
  })

  it('404 なら置かれていない', async () => {
    expect(await probeTrack('/a.mp3', respondWith(404, 'text/html'))).toBe(false)
  })

  it('200 でも中身が HTML なら置かれていない', async () => {
    // 開発用サーバーは見つからない時に index.html を返すことがある
    expect(await probeTrack('/a.mp3', respondWith(200, 'text/html'))).toBe(false)
  })

  it('Content-Type が無ければ置かれていない扱いにする', async () => {
    expect(await probeTrack('/a.mp3', respondWith(200, null))).toBe(false)
  })

  it('通信そのものが失敗しても投げずに false を返す', async () => {
    const failing = (async () => {
      throw new TypeError('network error')
    }) as unknown as typeof fetch
    expect(await probeTrack('/a.mp3', failing)).toBe(false)
  })
})
