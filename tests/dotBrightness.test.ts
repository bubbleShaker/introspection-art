import { describe, expect, it } from 'vitest'
import glSceneSource from '../src/scene/gl/glScene.ts?raw'
import bloomSource from '../src/scene/gl/shaders/bloom.frag.glsl?raw'

/**
 * 球の点は、ブルームに拾われてはいけない。
 *
 * 点が滲むと、線画ではなく煙に見える。滲ませないための約束は
 * 「点の明るさがブルームの閾値に届かない」ことひとつで、これは
 * **二つのファイルに跨がって**成り立っている（glScene.ts の DOT_LUMA と
 * bloom.frag の THRESHOLD）。片方だけ動かすと、例外も警告も出ないまま
 * 見え方だけが変わる。黙って壊れるものは、テストで留めておく。
 *
 * 点はシェーダーの後から重ねるので、あちらの最後にある明るさの圧縮
 * （col / (1 + col)）を通らない。DOT_LUMA には**圧縮を通した後の値**が
 * 置いてあり、ここでもそのまま輝度として読める。
 */
function constantOf(source: string, pattern: RegExp): number {
  const found = pattern.exec(source)
  expect(found, `${pattern} が見つからない`).not.toBeNull()
  return Number(found?.[1])
}

describe('点とブルームの取り決め', () => {
  it('点の白は、ブルームの閾値に届かない', () => {
    const luma = constantOf(glSceneSource, /const DOT_LUMA = ([\d.]+)/)
    const threshold = constantOf(bloomSource, /const float THRESHOLD = ([\d.]+);/)

    // 点は濃さ（アルファ）で半透明に打たれるので、画面へ出るのは背景と点の
    // あいだの色になる。背景が点より明るいところ（月・光の道）では合成結果も
    // 明るいままだが、それは元から滲んでいた光であって、点が足したものではない。
    // ここで押さえているのは「点のせいで新しく滲みが生まれることはない」の側
    expect(luma).toBeLessThan(threshold)
  })

  it('点の白は、背景と見分けが付く明るさである', () => {
    const luma = constantOf(glSceneSource, /const DOT_LUMA = ([\d.]+)/)

    // 閾値の下を狙うあまり暗くしすぎると、夜の海に沈んで点が読めなくなる。
    // 水面（WATER_FAR で 0.06 ほど）の何倍も明るいところに置く
    expect(luma).toBeGreaterThan(0.4)
  })
})
