/**
 * FFT の結果を「低・中・高」の三つの手応えに畳む。
 *
 * AnalyserNode が返す配列は、0Hz から (sampleRate / 2) までを
 * 等間隔の箱（ビン）に分けたもの。ある周波数帯が何番目の箱にあたるかは
 * sampleRate と fftSize だけで決まるので、ここは純粋な計算にできる。
 */

/** ひとつの帯域が占めるビンの範囲 [from, to)。to は含まない */
export type BinRange = { from: number; to: number }

/**
 * 周波数(Hz)の範囲を、AnalyserNode の周波数データ配列の添字範囲に直す。
 *
 * ビンの幅は sampleRate / fftSize。frequencyBinCount は fftSize / 2 なので、
 * 添字はそこで頭打ちにする。
 */
export function binRange(
  lowHz: number,
  highHz: number,
  sampleRate: number,
  fftSize: number,
): BinRange {
  const binCount = fftSize / 2
  const binWidth = sampleRate / fftSize
  const from = clampIndex(Math.floor(lowHz / binWidth), binCount)
  const to = clampIndex(Math.ceil(highHz / binWidth), binCount)
  // 幅が潰れると平均が NaN になるので、最低でも 1 ビンは残す
  return { from, to: Math.max(to, from + 1) }
}

function clampIndex(value: number, binCount: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, binCount)
}

/**
 * 指定範囲のビンを平均して 0..1 に正規化する。
 * getByteFrequencyData の値域が 0..255 なので 255 で割るだけでよい。
 */
export function bandLevel(freqData: Uint8Array, range: BinRange): number {
  const to = Math.min(range.to, freqData.length)
  const from = Math.min(range.from, to)
  if (to <= from) return 0

  let sum = 0
  for (let i = from; i < to; i++) sum += freqData[i]
  return sum / (to - from) / 255
}

/** 帯域の切り方。低域は波紋、中域は明るさ、高域はきらめきに効かせる */
export const BAND_HZ = {
  low: [20, 160],
  mid: [160, 2000],
  high: [2000, 8000],
} as const

/**
 * 前フレームの値へ向かって滑らかに寄せる。
 *
 * FFT の生の値はフレームごとに跳ねるので、そのまま画に入れると
 * 水面がちらつく。attack（上がる時）を速く、release（下がる時）を
 * 遅くすると、音が消えたあとも余韻が残って水面らしくなる。
 */
export function smooth(previous: number, next: number, attack: number, release: number): number {
  const rate = next > previous ? attack : release
  return previous + (next - previous) * rate
}
