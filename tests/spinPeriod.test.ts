import { describe, expect, it } from 'vitest'
import dotSphereSource from '../src/scene/dotSphere.ts?raw'
import glSceneSource from '../src/scene/gl/glScene.ts?raw'

/**
 * 球がひと回りする時間は、**二つのファイルに跨がって**決まる。
 *
 * 進める速さ（SPIN_IDLE）は glScene.ts が持ち、その量を何ラジアンの回転に
 * するか（spinMatrix の az の係数）は dotSphere.ts が持つ。片方だけ動かしても
 * 例外は出ず、回る速さが黙って変わる。しかも glScene.ts のコメントには
 * 「無音でひと回りおよそ 42 秒」と数字で書いてある。黙って食い違うものは、
 * テストで留めておく。
 */
function constantOf(source: string, pattern: RegExp): number {
  const found = pattern.exec(source)
  expect(found, `${pattern} が見つからない`).not.toBeNull()
  return Number(found?.[1])
}

describe('球の回る速さ', () => {
  it('無音でひと回りする時間が、二つのファイルの取り決めどおりになる', () => {
    const idle = constantOf(glSceneSource, /const SPIN_IDLE = ([\d.]+)/)
    // 回し切っているのは視線の軸まわり（az）だけ。ここの係数が周期を決める
    const perSpin = constantOf(dotSphereSource, /const az = t \* ([\d.]+) \+/)

    const seconds = (2 * Math.PI) / (idle * perSpin)

    // 曲の静けさに合う範囲。速すぎると落ち着かず、遅すぎると止まって見える
    expect(seconds).toBeGreaterThan(30)
    expect(seconds).toBeLessThan(60)
  })
})
