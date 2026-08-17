/**
 * 音から取り出した三つの手応え。すべて 0..1。
 *
 * 音声側と描画側の両方が使う共有の約束事なので、どちらの実装にも属さない
 * ここに置く。描画が FFT の都合を知らずに済む。
 */
export type Levels = { low: number; mid: number; high: number }

/** 無音。音源が無い時や止まっている時に返す */
export function silence(): Levels {
  return { low: 0, mid: 0, high: 0 }
}
