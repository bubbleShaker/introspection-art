/**
 * 波形を、球のまわりを一周する輪に畳む。
 *
 * p5 も WebGL も知らない純粋な計算にしてある。ここが「どの向きがどれだけ
 * 盛り上がるか」の唯一の出どころで、シェーダーは出来た輪を引くだけ。
 * ripples.ts と同じ扱い。
 *
 * 以前は同じ役目を waveRing.ts が持っていて、画面上の点列（x, y）を返していた。
 * 球にしたことで、必要なのは「向き → 高さ」だけになり、点の位置は
 * シェーダー側が交差判定から出す。
 */

/** シェーダーへ渡す時の vec4 の本数。scene.frag.glsl の WAVE_SLOTS と揃える */
export const WAVE_SLOTS = 32

/**
 * 輪をひと巡りするのに使う点の数。
 *
 * vec4 に 4 つずつ詰めるので、4 の倍数でなければならない。128 あれば、
 * 球の赤道をぐるりと回っても隣り合う点の段差が見えない。
 */
export const WAVE_RING_POINTS = WAVE_SLOTS * 4

/**
 * 波形にかける利得。
 *
 * 生の振幅をそのまま使うと、静かな曲ではほとんど動かない。持ち上げたぶん
 * 大音量で潰れないよう、tanh で頭を丸めて受け止める。
 */
const WAVE_GAIN = 2.6

/** 無音でも輪が死なないように加える、ごく弱い息づかい */
const BREATH = 0.07

/** 息づかいの速さ（1 秒あたりのラジアン） */
const BREATH_SPEED = 0.9

/**
 * 波形を輪へ畳んで out に書き出す。値域はおよそ -1..1。
 *
 * 毎フレーム走るので、書き込み先を受け取って使い回す（配列を捨てない）。
 *
 * 後半で前半を逆にたどっているのは、音の波形が輪になっていないため。
 * 素直に一周ぶん配ると、始点と終点で値が食い違って必ず継ぎ目が出る。
 * 折り返せば、一周の両端がどちらも同じ値になって繋がる。
 *
 * @param wave 波形 -1..1。長さは問わない（`WAVE_RING_POINTS / 2` 束に均す）
 * @param timeSec 息づかいの位相に使う時刻（秒）
 * @param out 書き込み先。`WAVE_RING_POINTS` の長さが要る
 */
export function packWaveRing(wave: Float32Array, timeSec: number, out: Float32Array): void {
  // 入れ物が足りなければ、入るぶんだけ書く。呼ぶ側が長さを取り違えていても
  // 配列の外へ書きに行かない
  const points = Math.min(WAVE_RING_POINTS, out.length)
  const half = WAVE_RING_POINTS / 2

  for (let i = 0; i < points; i++) {
    // 後半は前半を逆にたどる
    const bucket = i < half ? i : WAVE_RING_POINTS - 1 - i
    // 持ち上げた振幅を tanh で受け止める。大音量でも輪の形が潰れない
    const value = Math.tanh(average(wave, bucket, half) * WAVE_GAIN)
    const angle = (i / WAVE_RING_POINTS) * Math.PI * 2
    // 3 周期ぶんにしているので、一周してちょうど元に戻る（ここでも継ぎ目が出ない）
    out[i] = value + Math.sin(angle * 3 + timeSec * BREATH_SPEED) * BREATH
  }
}

/**
 * 波形を buckets 束に均した、その index 番目。
 *
 * 間引き（1 個おきに拾う）ではなく平均にしているのは、拾う位置がフレームごとに
 * ずれると輪郭がちらつくため。waveform.ts の畳み方と同じ理由。
 */
function average(wave: Float32Array, index: number, buckets: number): number {
  if (wave.length === 0) return 0

  const width = wave.length / buckets
  const start = Math.min(Math.floor(index * width), wave.length - 1)
  // 束が 1 サンプルに満たない（波形が輪の点より短い）時も、必ず 1 個は見る
  const end = Math.min(Math.max(Math.floor((index + 1) * width), start + 1), wave.length)

  let sum = 0
  for (let i = start; i < end; i++) sum += wave[i]
  return sum / (end - start)
}
