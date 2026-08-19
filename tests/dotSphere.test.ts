import { describe, expect, it } from 'vitest'
import { EYE_HEIGHT, HORIZON_UV } from '../src/scene/camera.ts'
import {
  buildDotDirections,
  DOT_ROWS,
  DOT_STRIDE,
  dotCount,
  projectDots,
  spinMatrix,
} from '../src/scene/dotSphere.ts'
import { packWaveRing, WAVE_RING_POINTS } from '../src/scene/waveSphere.ts'

/** 何も回っていない姿勢。投影だけを見たい時に使う */
const IDENTITY = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1])

/** 無音の輪（息づかいも止めた、まったいらな輪） */
function silentRing(): Float32Array {
  return new Float32Array(WAVE_RING_POINTS)
}

/** 投影に使う画面の縦。テストのあいだ変えない */
const HEIGHT = 800

/** 球の中心（ワールド）。dotSphere.ts の SPHERE_HOVER + SPHERE_RADIUS と FORWARD */
const CENTER_WORLD = { y: 0.22 + 0.62, depth: 3.6 }

/**
 * 球の中心が画面のどこに来るか。
 *
 * camera.ts の式（画面 → ワールド）を、こちらから辿り直したもの。定数を
 * 直書きせずに import しているのは、**片方だけ動くと球だけが海から浮く**ため。
 */
const CENTER_PX = {
  x: 0,
  y: -((CENTER_WORLD.y - EYE_HEIGHT) / CENTER_WORLD.depth + HORIZON_UV) * HEIGHT,
}

function project(dirs: Float32Array, ring: Float32Array, spin = IDENTITY): Float32Array {
  const out = new Float32Array(dotCount(dirs) * DOT_STRIDE)
  projectDots(dirs, ring, 0, spin, HEIGHT, out)
  return out
}

/** i 番目の点が、球の中心からどれだけ離れて見えるか */
function spread(dots: Float32Array, i: number): number {
  return Math.hypot(dots[i * DOT_STRIDE] - CENTER_PX.x, dots[i * DOT_STRIDE + 1] - CENTER_PX.y)
}

describe('buildDotDirections', () => {
  const dirs = buildDotDirections(DOT_ROWS)

  it('すべての向きが単位ベクトルになる', () => {
    for (let i = 0; i < dotCount(dirs); i++) {
      const length = Math.hypot(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2])
      expect(length).toBeCloseTo(1, 5)
    }
  })

  it('極そのものには点を置かない', () => {
    for (let i = 0; i < dotCount(dirs); i++) {
      // 極は経度が定まらず、波形の全部の値がぶつかるところ
      expect(Math.abs(dirs[i * 3 + 1])).toBeLessThan(0.999)
    }
  })

  it('極のまわりが密にならない（行の個数が緯度で変わる）', () => {
    // 同じ高さの点をひとまとまりに数える
    const perRow = new Map<string, number>()
    for (let i = 0; i < dotCount(dirs); i++) {
      const key = dirs[i * 3 + 1].toFixed(4)
      perRow.set(key, (perRow.get(key) ?? 0) + 1)
    }

    const rows = [...perRow.entries()].map(([y, count]) => ({ y: Number(y), count }))
    rows.sort((a, b) => a.y - b.y)

    // 赤道の行が、極に最も近い行より明らかに多い
    const equator = rows[Math.floor(rows.length / 2)]
    expect(equator.count).toBeGreaterThan(rows[0].count * 4)
  })

  it('行数を増やすと、点が増える', () => {
    expect(dotCount(buildDotDirections(30))).toBeGreaterThan(dotCount(buildDotDirections(20)))
  })

  it('既定の行数で 614 点になる', () => {
    // summary と dotSphere.ts のコメントが、この数を名指ししている
    expect(dotCount(dirs)).toBe(614)
  })
})

describe('spinMatrix', () => {
  const spin = new Float32Array(9)

  it('長さを変えない（回転である）', () => {
    spinMatrix(3.7, spin)

    for (const v of [
      [1, 0, 0],
      [0, 1, 0],
      [0.5, -0.5, Math.SQRT1_2],
    ]) {
      const x = spin[0] * v[0] + spin[1] * v[1] + spin[2] * v[2]
      const y = spin[3] * v[0] + spin[4] * v[1] + spin[5] * v[2]
      const z = spin[6] * v[0] + spin[7] * v[1] + spin[8] * v[2]
      expect(Math.hypot(x, y, z)).toBeCloseTo(Math.hypot(...v), 5)
    }
  })

  it('転置が逆になる（projectDots が裏返しに使える）', () => {
    spinMatrix(1.3, spin)

    // M と Mᵀ の積が単位行列
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += spin[r * 3 + k] * spin[c * 3 + k]
        expect(sum).toBeCloseTo(r === c ? 1 : 0, 5)
      }
    }
  })

  it('時刻が進むと姿勢が変わる', () => {
    const a = new Float32Array(9)
    const b = new Float32Array(9)
    spinMatrix(0, a)
    spinMatrix(2, b)
    expect([...a]).not.toEqual([...b])
  })
})

describe('projectDots', () => {
  const dirs = buildDotDirections(DOT_ROWS)

  /**
   * 投影は camera.ts（と scene.frag.glsl）の視線の式の裏返しで、片方だけ動くと
   * 球だけが海から浮いてずれる。しかも例外は出ない。
   *
   * 実際、最初の実装は面へ描く時の上下反転を落としていて、月との間隔が
   * 設計の 0.1 に対して 0.17 になっていた。ここで式そのものを留めておく。
   */
  it('camera.ts と同じ視線の式で、点を画面へ落とす', () => {
    // 球の真正面（目に向いた頂き）の 1 点だけを投影する
    const front = Float32Array.from([0, 0, 1])
    const out = new Float32Array(DOT_STRIDE)
    projectDots(front, silentRing(), 0, IDENTITY, HEIGHT, out)

    // 中心より半径ぶん手前に来るので、その奥行きで割る
    const depth = CENTER_WORLD.depth - 0.62

    expect(out[0]).toBeCloseTo(0, 5)
    expect(out[1]).toBeCloseTo(
      -((CENTER_WORLD.y - EYE_HEIGHT) / depth + HORIZON_UV) * HEIGHT,
      4,
    )
  })

  it('無音なら、点が画面上のひとつの円に収まる', () => {
    const out = project(dirs, silentRing())

    // 半径 0.62 / 奥行き 3.6 × 縦 800。手前の点は奥行きが縮むぶん少し外へ出る
    const radius = (0.62 / 3.6) * HEIGHT

    for (let i = 0; i < dotCount(dirs); i++) {
      expect(spread(out, i)).toBeLessThan(radius * 1.25)
    }
  })

  it('波形が満ちると、点が外へ出る', () => {
    const loud = new Float32Array(WAVE_RING_POINTS).fill(1)
    const quiet = project(dirs, silentRing())
    const wide = project(dirs, loud)

    // 赤道のあたり（極ではうねりが絞られる）で比べる
    let compared = 0
    for (let i = 0; i < dotCount(dirs); i++) {
      if (Math.abs(dirs[i * 3 + 1]) > 0.3) continue
      expect(spread(wide, i)).toBeGreaterThan(spread(quiet, i))
      compared++
    }
    expect(compared).toBeGreaterThan(0)
  })

  it('極へ近づくほど、うねりが絞られる', () => {
    const loud = new Float32Array(WAVE_RING_POINTS).fill(1)
    const quiet = project(dirs, silentRing())
    const wide = project(dirs, loud)

    // 極では経度が定まらない。そこで輪の全部の値がぶつからないよう、
    // 高いところほどうねりを細めてある
    let pole = Number.POSITIVE_INFINITY
    let equator = 0
    for (let i = 0; i < dotCount(dirs); i++) {
      const growth = spread(wide, i) / spread(quiet, i)
      if (Math.abs(dirs[i * 3 + 1]) > 0.99) pole = Math.min(pole, growth)
      if (Math.abs(dirs[i * 3 + 1]) < 0.1) equator = Math.max(equator, growth)
    }

    expect(pole).toBeLessThan(1.02)
    expect(equator).toBeGreaterThan(1.1)
  })

  it('向こう側の点は、手前の点より薄い', () => {
    const out = project(dirs, silentRing())

    let front = 0
    let back = 0
    for (let i = 0; i < dotCount(dirs); i++) {
      // 姿勢が単位行列なので、+z 側が手前
      if (dirs[i * 3 + 2] > 0.9) front = out[i * DOT_STRIDE + 3]
      if (dirs[i * 3 + 2] < -0.9) back = out[i * DOT_STRIDE + 3]
    }

    expect(front).toBeGreaterThan(back)
    expect(back).toBeGreaterThan(0)
  })

  it('手前の点ほど大きく見える', () => {
    const out = project(dirs, silentRing())

    let front = 0
    let back = 0
    for (let i = 0; i < dotCount(dirs); i++) {
      if (dirs[i * 3 + 2] > 0.9) front = out[i * DOT_STRIDE + 2]
      if (dirs[i * 3 + 2] < -0.9) back = out[i * DOT_STRIDE + 2]
    }

    expect(front).toBeGreaterThan(back)
    expect(back).toBeGreaterThan(0)
  })

  it('息づかいだけの輪でも、数が壊れない', () => {
    const ring = new Float32Array(WAVE_RING_POINTS)
    packWaveRing(new Float32Array(0), 1.5, ring)
    const out = project(dirs, ring)

    for (const value of out) expect(Number.isFinite(value)).toBe(true)
  })

  it('書き込み先が足りなければ、入るぶんだけ書いて配列の外へ出ない', () => {
    const out = new Float32Array(3 * DOT_STRIDE)
    const written = projectDots(dirs, silentRing(), 0, IDENTITY, 800, out)
    expect(written).toBe(3)
  })
})
