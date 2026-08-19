import { describe, expect, it } from 'vitest'
import {
  EYE_HEIGHT,
  HORIZON_UV,
  MOON_UV_Y,
  moonDirection,
  waterPointAt,
} from '../src/scene/camera.ts'

/**
 * シェーダーが視線を組み立てている式を、こちら側からもう一度解く。
 * 二つが一致していることが、このファイルの存在理由。
 *
 *   vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
 *   vec3 rd = normalize(vec3(uv.x, uv.y - uHorizon, -1.0));
 *   float dist = uEyeHeight / -rd.y;
 *   vec3 hit  = vec3(0.0, uEyeHeight, 0.0) + rd * dist;
 */
function traceLikeShader(x: number, depth: number, aspect: number): { x: number; z: number } {
  const uvX = (x - 0.5) * aspect
  const uvY = HORIZON_UV - depth * (HORIZON_UV + 0.5)

  const dir = [uvX, uvY - HORIZON_UV, -1]
  const length = Math.hypot(dir[0], dir[1], dir[2])
  const rd = dir.map((v) => v / length)

  const dist = EYE_HEIGHT / -rd[1]
  return { x: rd[0] * dist, z: rd[2] * dist }
}

describe('waterPointAt', () => {
  it('シェーダーが視線から出す交点と一致する', () => {
    for (const depth of [0.1, 0.3, 0.5, 0.75, 1]) {
      for (const x of [0, 0.25, 0.5, 0.9]) {
        const expected = traceLikeShader(x, depth, 1.6)
        const actual = waterPointAt(x, depth, 1.6)
        expect(actual.x).toBeCloseTo(expected.x, 6)
        expect(actual.z).toBeCloseTo(expected.z, 6)
      }
    }
  })

  it('手前ほど近く、水平線際ほど遠い', () => {
    const near = waterPointAt(0.5, 1, 1.6)
    const far = waterPointAt(0.5, 0.2, 1.6)
    expect(near.forward).toBeLessThan(far.forward)
  })

  it('画面の中央に落ちたものは、水面でも正面に来る', () => {
    expect(waterPointAt(0.5, 0.6, 1.6).x).toBeCloseTo(0)
  })

  it('横長の画面ほど、同じ横位置が外へ開く', () => {
    const narrow = waterPointAt(1, 0.6, 1)
    const wide = waterPointAt(1, 0.6, 2)
    expect(wide.x).toBeGreaterThan(narrow.x)
  })

  it('水平線ちょうどでも、隔たりが無限に飛ばない', () => {
    // depth 0 は視線が水面と平行で、素直に解くと交点が無限遠になる
    const point = waterPointAt(0.5, 0, 1.6)
    expect(Number.isFinite(point.forward)).toBe(true)
    expect(Number.isFinite(point.z)).toBe(true)
  })
})

describe('moonDirection', () => {
  it('長さ 1 の向きを返す', () => {
    for (const moonX of [0, 0.3, 0.5, 1]) {
      const [x, y, z] = moonDirection(moonX, 1.6)
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 6)
    }
  })

  it('水平線より上を向く', () => {
    expect(MOON_UV_Y).toBeGreaterThan(HORIZON_UV)
    expect(moonDirection(0.5, 1.6)[1]).toBeGreaterThan(0)
  })

  it('画面の中央にある時は真正面', () => {
    expect(moonDirection(0.5, 1.6)[0]).toBeCloseTo(0)
  })

  it('右へ動かすと向きも右へ振れる', () => {
    expect(moonDirection(0.8, 1.6)[0]).toBeGreaterThan(moonDirection(0.6, 1.6)[0])
  })
})
