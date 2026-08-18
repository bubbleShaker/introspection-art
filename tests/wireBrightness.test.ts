import { describe, expect, it } from 'vitest'
import bloomSource from '../src/scene/gl/shaders/bloom.frag.glsl?raw'
import sceneSource from '../src/scene/gl/shaders/scene.frag.glsl?raw'

/**
 * 格子の線は、ブルームに拾われてはいけない。
 *
 * 線が滲むと、線画ではなく煙に見える。滲ませないための約束は
 * 「線の明るさが、出力の圧縮を通ってもブルームの閾値に届かない」ことひとつで、
 * これは **二つのファイルに跨がって**成り立っている（scene.frag の WIRE_COLOR と
 * bloom.frag の THRESHOLD）。片方だけ動かすと、例外も警告も出ないまま
 * 見え方だけが変わる。黙って壊れるものは、テストで留めておく。
 */
function constantOf(source: string, pattern: RegExp): number {
  const found = pattern.exec(source)
  expect(found, `${pattern} が見つからない`).not.toBeNull()
  return Number(found?.[1])
}

describe('線とブルームの取り決め', () => {
  it('線の白は、圧縮を通してもブルームの閾値に届かない', () => {
    const wire = constantOf(sceneSource, /const vec3 WIRE_COLOR = vec3\(([\d.]+)\);/)
    const threshold = constantOf(bloomSource, /const float THRESHOLD = ([\d.]+);/)

    // scene.frag の最後で col / (1 + col) に圧縮される。無彩色なので、
    // bloom.frag が測る輝度（重みの総和が 1）はこの値そのものになる。
    //
    // 線は WIRE_ALPHA で半透明になったので、実際に画面へ出るのは背景と
    // 混ざった色であり、この値より必ず暗い。ここで押さえているのは
    // 「いちばん濃く出たとしても届かない」という上限の側
    const luma = wire / (1 + wire)

    expect(luma).toBeLessThan(threshold)
  })

  it('線の白は、背景と見分けが付く明るさである', () => {
    const wire = constantOf(sceneSource, /const vec3 WIRE_COLOR = vec3\(([\d.]+)\);/)

    // 閾値の下を狙うあまり暗くしすぎると、夜の海に沈んで線が読めなくなる。
    // 水面（WATER_FAR で 0.06 ほど）の何倍も明るいところに置く
    expect(wire / (1 + wire)).toBeGreaterThan(0.4)
  })
})
