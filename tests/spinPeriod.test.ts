import { describe, expect, it } from 'vitest'
import glSceneSource from '../src/scene/gl/glScene.ts?raw'
import sceneSource from '../src/scene/gl/shaders/scene.frag.glsl?raw'

/**
 * 球の格子がひと回りする時間は、**二つのファイルに跨がって**決まる。
 *
 * 進める速さ（SPIN_IDLE）は glScene.ts が持ち、その量を何ラジアンの回転に
 * するか（spinMatrix の az の係数）は scene.frag.glsl が持つ。片方だけ動かしても
 * 例外は出ず、回る速さが黙って変わる。しかも glScene.ts のコメントには
 * 「無音でひと回りおよそ 42 秒」と数字で書いてある。黙って食い違うものは、
 * テストで留めておく。
 */
function constantOf(source: string, pattern: RegExp): number {
  const found = pattern.exec(source)
  expect(found, `${pattern} が見つからない`).not.toBeNull()
  return Number(found?.[1])
}

describe('格子の回る速さ', () => {
  it('無音でひと回りする時間が、二つのファイルの取り決めどおりになる', () => {
    const idle = constantOf(glSceneSource, /const SPIN_IDLE = ([\d.]+)/)
    // 回し切っているのは視線の軸まわり（az）だけ。ここの係数が周期を決める
    const perSpin = constantOf(sceneSource, /float az = t \* ([\d.]+) \+/)

    const seconds = (2 * Math.PI) / (idle * perSpin)

    // 曲の静けさに合う範囲。速すぎると落ち着かず、遅すぎると止まって見える
    expect(seconds).toBeGreaterThan(30)
    expect(seconds).toBeLessThan(60)
  })
})

describe('格子の目', () => {
  it('本数は奇数である', () => {
    // 偶数だと真ん中の線が弧 ±PI/2、つまり軸が球を貫く点の上に乗る。
    // そこは線が点に潰れるので、白い粒がちらつく
    const cols = constantOf(sceneSource, /const float GRID_COLS = ([\d.]+);/)
    const rows = constantOf(sceneSource, /const float GRID_ROWS = ([\d.]+);/)

    expect(cols % 2).toBe(1)
    expect(rows % 2).toBe(1)
  })
})
