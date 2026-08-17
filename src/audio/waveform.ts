/**
 * 時間領域の波（音そのものの形）を、描く側が扱える点列に畳む。
 *
 * FFT の帯域（bands.ts）が「どれくらい強いか」を答えるのに対し、こちらは
 * 「今どんな形で震えているか」を答える。円形の波形は後者でしか描けない。
 *
 * ここは AnalyserNode を知らない純粋な計算にしてある。入るのは
 * getByteTimeDomainData が返すのと同じ形の配列（0..255、無音が 128）だけ。
 */

/**
 * 波形を何点に畳むか。
 *
 * 128 あれば、輪郭を線でなぞっても折れ線に見えない。これ以上細かくしても、
 * 平均を取る幅が狭くなって形が跳ねるだけで、見た目は良くならない。
 */
export const WAVE_POINTS = 128

/** 無音の波形。音源が無い時や止まっている時に配る */
export function silentWave(): Float32Array {
  return new Float32Array(WAVE_POINTS)
}

/**
 * 生のサンプル列を out の長さぶんの点に畳む。値域はほぼ -1..1
 * （0..255 を中心 128 で割るので、正側だけ 0.992 で止まる。実害は無い）。
 *
 * 間引き（1 個おきに拾う）ではなく**平均**にしているのは、拾う位置が
 * フレームごとにずれると波形がちらつくため。平均は高い周波数を落とすので、
 * 結果として輪郭が落ち着く。
 *
 * @param samples 0..255 の時間領域データ（128 が無音）
 * @param out 書き込み先。長さがそのまま点の数になる
 */
export function foldWaveform(samples: Uint8Array, out: Float32Array): void {
  const points = out.length
  if (points === 0) return

  // サンプルが点の数より少ない環境でも、少なくとも 1 個は見る
  const width = samples.length / points

  for (let i = 0; i < points; i++) {
    const from = Math.floor(i * width)
    const to = Math.max(from + 1, Math.floor((i + 1) * width))
    let sum = 0
    let count = 0

    for (let j = from; j < to && j < samples.length; j++) {
      sum += samples[j]
      count++
    }

    // 拾えるサンプルが尽きた（samples が空、または out の方が長い）
    out[i] = count === 0 ? 0 : (sum / count - 128) / 128
  }
}

/**
 * 波形を、今の値へ向けて少しずつ寄せる（その場で書き換える）。
 *
 * 生のままだとフレームごとに跳ねて輪郭がちらつく。帯域の smooth() と違って
 * 上がる時と下がる時で速さを変えないのは、波形が符号付きだから。片方だけ
 * 速いと、波の山と谷で追従の速さが変わって形が歪む。
 *
 * @param current ならした波形。ここが書き換わる
 * @param target 今読み出したばかりの波形
 * @param rate 追いつく速さ。0 で止まり、1 で生のまま
 */
export function followWave(current: Float32Array, target: Float32Array, rate: number): void {
  const count = Math.min(current.length, target.length)
  for (let i = 0; i < count; i++) {
    current[i] += (target[i] - current[i]) * rate
  }
}
