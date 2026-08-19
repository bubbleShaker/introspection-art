/**
 * 点の格子でできた球。音の波形で、点が半径方向にうねる。
 *
 * p5 も WebGL も知らない純粋な計算にしてある。ここが「どの点が画面のどこに、
 * どれだけの大きさと濃さで来るか」の唯一の出どころで、描く側は出た数を打つだけ
 * （p5 の都合で、大きさだけは濃さの段ごとに均されている）。
 * ripples.ts・waveSphere.ts と同じ扱い。
 *
 * 球を**面ではなく点の集まり**にしたので、レイと球の交差を解く必要がない。
 * 半径が向きごとに変わっても、点の位置を出して投影するだけで済む
 * （面のままうねらせると、交差が解析では解けなくなってレイマーチが要る）。
 *
 * 以前は同じ球を scene.frag.glsl が持っていて、格子「線」の濃さだけが音で
 * 上下していた。形を歪ませると輪郭がヨレて見えたためだが、ヨレていたのは
 * 面と輪郭線を持っていたからで、点にはどちらも無い。
 */

import { EYE_HEIGHT, HORIZON_UV } from './camera.ts'
import { waveAt } from './waveSphere.ts'

/** 目からの奥行き（-z 方向） */
const SPHERE_FORWARD = 3.6

/**
 * 半径。呼吸（SPHERE_BREATH）とうねり（WAVE_AMOUNT）で、ここから上下する。
 *
 * 見かけの大きさ（uv 系）はおよそ 半径 / 奥行き になる。0.62 / 3.6 ≒ 0.17。
 *
 * 大きくしすぎると月（camera.ts の MOON_UV_Y）に触れ、水面の光の道ごと隠して
 * しまう。月の高さを動かす時は、こちらも一緒に見ること。
 */
const SPHERE_RADIUS = 0.62

/** 水面からどれだけ浮いているか。画面上の高さを決める */
const SPHERE_HOVER = 0.22

/** 球の中心（ワールド） */
const CENTER_X = 0
const CENTER_Y = SPHERE_HOVER + SPHERE_RADIUS
const CENTER_Z = -SPHERE_FORWARD

/**
 * 呼吸の深さ。低域がいっぱいの時に、球ぜんたいがこの割合だけ膨らむ。
 *
 * 向きに依らない一定倍なので、これだけでは形が変わらず大きさが脈打つ。
 */
const SPHERE_BREATH = 0.06

/**
 * うねりの深さ。波形いっぱいの向きで、半径がこの割合だけ外へ出る。
 *
 * 0.1 を割ると、輪郭が真円にしか見えない。逆に 0.4 を越えたあたりから、
 * 内へ入った点と外へ出た点が混ざって球の面が読めなくなり、点の雲になる
 * （0.6 で試すと、もう球には見えない）。
 */
const WAVE_AMOUNT = 0.22

/**
 * 緯度方向に並べる行の数。
 *
 * 点の総数はおよそ 1.27 × 行数² になる（下の buildDotDirections を見ること）。
 * 22 行で 614 点。増やすと格子が細かくなるが、点が小さいままだと
 * 潰れて霞に見える。
 */
export const DOT_ROWS = 22

/**
 * 点ひとつの大きさ（ワールド単位の直径）。
 *
 * 画面上の大きさは、これを奥行きで割った見込み角で決まる。球のところでは
 * およそ 0.02 / 3.6 ≒ 縦の 0.56%。縦 640px で 3.5px。
 *
 * これ以上小さいと、夜の海に沈んで点が霞に見える。大きくすると、隣り合う
 * 点がくっついて行が 1 本の線に戻ってしまう。
 */
const DOT_SIZE = 0.02

/**
 * 手前を向いている点の濃さ。
 *
 * DOT_BACK と対で、projectDots が出す濃さの値域そのものになる。描く側は
 * この幅を段に切って打つので、両方とも公開してある。
 */
export const DOT_FRONT = 1

/**
 * 向こう側の点の濃さ。
 *
 * 薄くすると、奥と手前が見分けられて球の中が空いて見える。線だった頃の
 * WIRE_BACK と同じ役目。
 */
export const DOT_BACK = 0.35

/** 1 点あたりの書き出し要素数。[x, y, 大きさ, 濃さ] */
export const DOT_STRIDE = 4

/**
 * 点の向きを、球面上でおよそ等間隔に並べる。
 *
 * 緯度経度の素直な格子は極へ点が密集する（同じ個数を、短くなる一方の緯線へ
 * 並べるため）。行ごとに個数を変えて、経度方向の間隔を緯度方向の間隔へ揃える。
 * 行が並んで見えるので「格子」の印象は保たれる。
 *
 * 行ごとに半分ずらしているのは、隣の行と点が縦に揃うと、たまたま並んだ列が
 * 筋に見えてしまうため。千鳥にすると、どの向きから見ても点が散る。
 *
 * 出来た向きは動かないので、呼ぶのは組み立ての一度きりでよい。うねるのは
 * 半径の方である。
 *
 * @param rows 緯度方向の行数
 * @returns x, y, z の順に詰めた単位ベクトルの列
 */
export function buildDotDirections(rows: number = DOT_ROWS): Float32Array {
  const dirs: number[] = []

  for (let row = 0; row < rows; row++) {
    // 行の中心を取る（+0.5）。極そのものには点を置かない。極は経度が定まらず、
    // 波形の全部の値がぶつかるところなので、そこに点があるとちらつく
    const theta = (Math.PI * (row + 0.5)) / rows
    const y = Math.cos(theta)
    const around = Math.sin(theta)

    // 緯度方向の間隔は PI / rows。同じ間隔で経度を刻むと、この行には
    // 2π・sin(θ) / (π / rows) = 2・rows・sin(θ) 個が並ぶ
    const count = Math.max(1, Math.round(2 * rows * around))
    // 隣の行と半分ずらす
    const offset = (row % 2) * 0.5

    for (let i = 0; i < count; i++) {
      const phi = ((i + offset) / count) * Math.PI * 2
      dirs.push(Math.cos(phi) * around, y, Math.sin(phi) * around)
    }
  }

  return Float32Array.from(dirs)
}

/** buildDotDirections が返す向きの数 */
export function dotCount(dirs: Float32Array): number {
  return Math.floor(dirs.length / 3)
}

/**
 * 格子の姿勢。ワールドの向きを、格子の側の向きへ持ち込む 3×3（行優先）。
 *
 * 球そのものは向きを持たない（どう回しても同じ真円）ので、回るのは点の並びと
 * 波形の輪の方である。
 *
 * **3 軸を等しく回し切ってはいけない**。点が行として読めるのは、行の軸が画面の
 * 面に寝ているあいだで、軸がこちらを向くと行はまとめて同心円に化ける。
 * そこで、視線の軸（z）まわりだけを回し切り、残る 2 軸は振れ幅を抑えて揺らす。
 *
 * 周期を揃えないのは、揃えると決まった周期で同じ姿勢へ戻ってきて、回転が
 * 「往復」に見えてしまうため。
 *
 * 時計（t）は glScene.ts で積み上げたもの。音で速さが変わっても位相が飛ばない。
 */
export function spinMatrix(t: number, out: Float32Array): void {
  // 画面の面から起こす向き。振れ幅を持たせるだけで、回し切らない
  const ax = Math.sin(t * 0.19) * 0.42
  const ay = Math.sin(t * 0.13 + 2.2) * 0.38
  // 視線の軸まわり。ここだけを回し切る
  const az = t * 0.3 + Math.sin(t * 0.11) * 0.5

  const sx = Math.sin(ax)
  const cx = Math.cos(ax)
  const sy = Math.sin(ay)
  const cy = Math.cos(ay)
  const sz = Math.sin(az)
  const cz = Math.cos(az)

  // Rx・Ry・Rz を、掛けた形のまま置いてある。まとめて展開すると速いが、
  // どの軸がどれだけ回っているのかが読めなくなる。呼ばれるのは 1 フレームに
  // 一度だけなので、読める方を取る
  const yz = [cy * cz, -cy * sz, sy, sz, cz, 0, -sy * cz, sy * sz, cy]

  // Rx を左から掛ける。x まわりの回転は 1 行目に触らないので、そこは素通し
  out[0] = yz[0]
  out[1] = yz[1]
  out[2] = yz[2]
  out[3] = cx * yz[3] - sx * yz[6]
  out[4] = cx * yz[4] - sx * yz[7]
  out[5] = cx * yz[5] - sx * yz[8]
  out[6] = sx * yz[3] + cx * yz[6]
  out[7] = sx * yz[4] + cx * yz[7]
  out[8] = sx * yz[5] + cx * yz[8]
}

/**
 * 点を画面へ落とす。書き込み先へ [x, y, 大きさ, 濃さ] を点の数だけ並べる。
 *
 * 座標は p5 の WEBGL キャンバスに合わせて、**画面の中央が原点・y は下が正**の
 * ピクセル。大きさは直径のピクセル、濃さは 0..1。
 *
 * 視線の作り方は scene.frag.glsl と同じで、camera.ts に書いてある式の裏返し
 * （あちらは画面 → ワールド、こちらはワールド → 画面）。**片方だけ変えると、
 * 球だけが海から浮いてずれる**。
 *
 * 毎フレーム走るので、書き込み先を受け取って使い回す（配列を捨てない）。
 *
 * @param dirs buildDotDirections が返した向き
 * @param ring packWaveRing が書いた輪
 * @param low 低域の強さ 0..1（球ぜんたいの呼吸）
 * @param spin spinMatrix が書いた姿勢
 * @param height 画面の縦のピクセル数（uv 系はこれで正規化されている）
 * @param out 書き込み先。点の数 × DOT_STRIDE の長さが要る
 * @returns 実際に書いた点の数
 */
export function projectDots(
  dirs: Float32Array,
  ring: Float32Array,
  low: number,
  spin: Float32Array,
  height: number,
  out: Float32Array,
): number {
  const count = Math.min(dotCount(dirs), Math.floor(out.length / DOT_STRIDE))
  const breathing = SPHERE_RADIUS * (1 + low * SPHERE_BREATH)

  for (let i = 0; i < count; i++) {
    // 格子の側の向き。波形の輪もここで引く（格子と一緒に波形も回る）
    const gx = dirs[i * 3]
    const gy = dirs[i * 3 + 1]
    const gz = dirs[i * 3 + 2]

    // 姿勢はワールド → 格子なので、点をワールドへ置くには裏返す。
    // 回転行列の逆は転置なので、列で読むだけでよい
    const wx = spin[0] * gx + spin[3] * gy + spin[6] * gz
    const wy = spin[1] * gx + spin[4] * gy + spin[7] * gz
    const wz = spin[2] * gx + spin[5] * gy + spin[8] * gz

    const radius = breathing * (1 + waveAt(ring, gx, gz) * WAVE_AMOUNT)

    // 目から点までのベクトル
    const vx = CENTER_X + wx * radius
    const vy = CENTER_Y + wy * radius - EYE_HEIGHT
    const vz = CENTER_Z + wz * radius

    // 奥行き。球は目の前にあるので、ここが 0 以下になることはない。
    // それでも 0 で割らないように止めておく
    const depth = Math.max(-vz, 1e-3)

    const offset = i * DOT_STRIDE
    out[offset] = (vx / depth) * height
    // uv 系は上が正、p5 のキャンバスは下が正
    out[offset + 1] = -(vy / depth + HORIZON_UV) * height
    out[offset + 2] = (DOT_SIZE / depth) * height

    // 点の向きと視線の向きが揃っているほど、球の向こう側にいる。
    // 輪郭（直角）で切り替わるのではなく、少し手前から翳らせる
    const distance = Math.hypot(vx, vy, vz)
    const facing = (wx * vx + wy * vy + wz * vz) / Math.max(distance, 1e-6)
    out[offset + 3] = DOT_FRONT + (DOT_BACK - DOT_FRONT) * smoothstep(-0.25, 0.55, facing)
  }

  return count
}

/** 端を滑らかにした 0..1 の切り替え。GLSL の smoothstep と同じ */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
