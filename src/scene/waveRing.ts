/**
 * 波形を円の輪郭に変える。
 *
 * p5 も WebGL も知らない純粋な計算にしてある。ここが「どこに点を置くか」の
 * 唯一の出どころで、描く側は出来た点をなぞるだけ。ripples.ts と同じ扱い。
 */

/**
 * 波形にかける利得。
 *
 * 生の振幅をそのまま使うと、静かな曲ではほとんど真円のまま動かない。
 * 持ち上げたぶん大音量で潰れないよう、tanh で頭を丸めて受け止める。
 */
const WAVE_GAIN = 2.6

/** 無音でも輪が死なないように加える、ごく弱い息づかい（半径に対する割合） */
const BREATH = 0.013

/** 息づかいの速さ（1 秒あたりのラジアン） */
const BREATH_SPEED = 0.9

/**
 * 輪をひと巡りするのに要る点の数。
 *
 * 波形を左右に折り返すので、波形の点の数の 2 倍になる。折り返すのは、
 * 音の波形が輪になっていないため。素直に一周ぶん配ると、始点と終点で
 * 値が食い違って必ず継ぎ目が出る。
 */
export function ringPointCount(waveLength: number): number {
  return waveLength * 2
}

/**
 * 輪郭の点を out へ書き出す。x, y の順に交互に詰める。
 *
 * 毎フレーム走るので、書き込み先を受け取って使い回す（配列を捨てない）。
 *
 * @param wave 波形 -1..1
 * @param radius 基準半径
 * @param swing 波形が半径をどれだけ揺らすか
 * @param timeSec 息づかいの位相に使う時刻（秒）
 * @param out 書き込み先。`ringPointCount(wave.length) * 2` の長さが要る
 * @returns 実際に書けた点の数
 */
export function traceWaveRing(
  wave: Float32Array,
  radius: number,
  swing: number,
  timeSec: number,
  out: Float32Array,
): number {
  const total = ringPointCount(wave.length)
  // 入れ物が足りなければ、入るぶんだけ書く。描く側が長さを取り違えていても
  // 配列の外へ書きに行かない
  const points = Math.min(total, Math.floor(out.length / 2))

  for (let i = 0; i < points; i++) {
    // 後半は前半を逆にたどる
    const sample = i < wave.length ? wave[i] : wave[total - 1 - i]
    // 持ち上げた振幅を tanh で受け止める。大音量でも輪の形が潰れない
    const value = Math.tanh(sample * WAVE_GAIN)
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2
    // 3 周期ぶんにしているので、一周してちょうど元に戻る（ここでも継ぎ目が出ない）
    const breath = Math.sin(angle * 3 + timeSec * BREATH_SPEED) * BREATH
    const r = radius * (1 + breath) + value * swing

    out[i * 2] = Math.cos(angle) * r
    out[i * 2 + 1] = Math.sin(angle) * r
  }

  return points
}
