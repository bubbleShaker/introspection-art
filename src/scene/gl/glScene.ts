import p5 from 'p5'
import type { Levels } from '../../core/levels.ts'
import { opacityRatio, progress, radiusRatio, RippleField } from '../ripples.ts'
import fragmentSource from './shaders/scene.frag.glsl?raw'
import vertexSource from './shaders/scene.vert.glsl?raw'

/**
 * 水面と反射（GPU 版）。
 *
 * 画面いっぱいの板を 1 枚張り、そこに 1 本のフラグメントシェーダーを貼る。
 * 絵の中身は全部 GLSL 側にあり、ここが持つのは「キャンバスの用意」と
 * 「音から出た値をシェーダーへ渡すこと」だけ。
 *
 * p5 の描画ループは止めてある（noLoop）。時計は main.ts の
 * requestAnimationFrame 一本に任せ、そこから redraw() を呼ぶ。
 * 音のスムージングと打点検出は今までどおり main.ts 側に残る。
 */

/** 水平線の高さ。uv 系（画面中央が 0、上が正、縦の半分で 0.5） */
const HORIZON_UV = 0.08

/** 月の高さ。同じく uv 系 */
const MOON_UV_Y = 0.35

/** 高 DPI で素直に倍率を上げると、ピクセルごとの計算量が跳ねる。2 で頭打ちにする */
const MAX_PIXEL_DENSITY = 2

/**
 * 水面からの目の高さ（ワールド単位）。
 *
 * 波の周期はワールド単位で決めてあるので、この値が「どれくらいの大きさの波を
 * 見ているか」の基準になる。シェーダーへは uniform で渡すので、定義はここだけ。
 */
const EYE_HEIGHT = 1.0

/** シェーダーが一度に受け取れる波紋の数。scene.frag.glsl の MAX_RIPPLES と揃える */
const MAX_RIPPLES = 12

/** 波紋の広がりきった半径（ワールド単位） */
const RIPPLE_MAX_RADIUS = 0.85

export class GlWaterScene {
  private readonly instance: p5
  private readonly motion: number
  private readonly random: () => number

  private shader: p5.Shader | null = null
  private levels: Levels = { low: 0, mid: 0, high: 0 }

  private readonly ripples = new RippleField()
  /** 波紋をシェーダーへ渡すための入れ物。毎フレーム作り直さず、詰め替える */
  private readonly rippleBuffer = new Float32Array(MAX_RIPPLES * 4)
  private rippleCount = 0

  /** 月の横位置（0..1）。ゆっくり漂う */
  private moonX = 0.5

  private lastFrameMs: number | null = null

  /**
   * 波の位相に使う時刻（秒）。
   *
   * 速さが音で変わるものは、時刻に係数を掛けてはいけない。sin(t * k) の k を
   * 動かすと t が大きいほど位相が飛び、数分後にはただのノイズになる。
   * 毎フレームぶんだけ足して積み上げれば、速さを変えても位相は連続する。
   */
  private time = 0

  constructor(
    container: HTMLElement,
    options: { random?: () => number; reducedMotion?: boolean } = {},
  ) {
    this.random = options.random ?? Math.random
    this.motion = options.reducedMotion ? 0.3 : 1

    this.instance = new p5((sketch: p5) => {
      sketch.setup = () => {
        const canvas = sketch.createCanvas(
          container.clientWidth || window.innerWidth,
          container.clientHeight || window.innerHeight,
          sketch.WEBGL,
        )
        // 板を貼るだけなので、輪郭線は要らない
        sketch.noStroke()
        sketch.pixelDensity(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_DENSITY))
        this.shader = sketch.createShader(vertexSource, fragmentSource)

        // 音に反応する絵そのものは、支援技術には読めない。何が映っているかを
        // 言葉で置いておく
        canvas.elt.setAttribute('role', 'img')
        canvas.elt.setAttribute('aria-label', '音に反応して揺れる水面と、その反射')

        sketch.noLoop()
      }

      sketch.draw = () => this.render(sketch)
    }, container)
  }

  /** 表示サイズに合わせてキャンバスを取り直す */
  resize(): void {
    const width = this.instance.width
    const height = this.instance.height
    const next = {
      width: window.innerWidth,
      height: window.innerHeight,
    }
    if (next.width === width && next.height === height) return
    this.instance.resizeCanvas(next.width, next.height)
  }

  /**
   * 波紋をひとつ落とす。低域の打点や、無音時の自律的な揺らぎから呼ばれる。
   * 落ちる場所は月の下あたりに寄せる（光の道が乱れるのが一番よく見える）。
   */
  splash(strength: number, nowMs: number): void {
    // 一様乱数を二つ足すと中央に寄った分布になる。月の真下に集めすぎず、
    // かといって画面端にばらけすぎない散り方になる
    const spread = (this.random() + this.random() - 1) * 0.34
    const x = Math.max(0, Math.min(1, this.moonX + spread))
    // 手前寄りに落とす。水平線際は水面までの距離が跳ね上がるので、
    // そこへ落とした波紋はワールドでは遥か遠くになり、輪が見えなくなる
    const depth = 0.30 + this.random() ** 1.3 * 0.68
    this.ripples.spawn(x, depth, strength, nowMs)
  }

  /** 1 フレーム描く */
  draw(levels: Levels, nowMs: number): void {
    // タブが裏に回っていた等で大きく飛んだ時は、進める時間を頭打ちにする
    // （そのまま使うと波の位相が飛ぶ）
    const deltaMs = this.lastFrameMs === null ? 0 : Math.min(nowMs - this.lastFrameMs, 100)
    this.lastFrameMs = nowMs

    // 高域が強いほど水面のきらめきが速くなる
    this.time += (deltaMs / 1000) * (0.6 + levels.high * 1.4) * this.motion
    this.moonX = 0.5 + Math.sin(nowMs * 0.00004) * 0.07

    this.ripples.prune(nowMs)
    this.packRipples(nowMs)

    this.levels = levels
    this.instance.redraw()
  }

  /**
   * 波紋を、シェーダーが読める形（水面上の位置・今の半径・今の強さ）へ詰め替える。
   *
   * 半径の伸び方と薄れ方は ripples.ts のままにしてある。あの式にはテストが
   * あるので、シェーダー側で書き直すと確かめようがなくなる。ここは
   * 「画面上の位置を水面上の位置へ直す」ことだけを引き受ける。
   */
  private packRipples(nowMs: number): void {
    const aspect = this.instance.width / Math.max(1, this.instance.height)
    const items = this.ripples.items
    // 溢れたら新しいものを優先する。古い波紋は既に薄い
    const start = Math.max(0, items.length - MAX_RIPPLES)
    let count = 0

    for (let i = start; i < items.length; i++) {
      const ripple = items[i]
      const t = progress(ripple, nowMs)
      const amplitude = opacityRatio(t) * ripple.strength
      if (amplitude <= 0.002) continue

      // 画面の (x, depth) を水面上の位置へ。視線と水面の交点を解くと、
      // 距離は depth に反比例する（手前ほど近い）
      const distance = EYE_HEIGHT / (Math.max(ripple.depth, 0.04) * (HORIZON_UV + 0.5))
      const offset = 4 * count

      this.rippleBuffer[offset] = (ripple.x - 0.5) * aspect * distance
      this.rippleBuffer[offset + 1] = -distance
      // 遠くの波紋も見えるように、距離ぶんだけ大きさを持ち上げる。
      // 実際の水面では遠い輪ほど小さく見えるが、それだと打点が届かない
      this.rippleBuffer[offset + 2] =
        radiusRatio(t) * RIPPLE_MAX_RADIUS * (0.6 + ripple.strength * 0.8) * (1 + distance * 0.16)
      this.rippleBuffer[offset + 3] = amplitude

      count++
      if (count >= MAX_RIPPLES) break
    }

    this.rippleCount = count
  }

  /** p5 の draw から呼ばれる。uniform を詰めて板を 1 枚描く */
  private render(sketch: p5): void {
    const shader = this.shader
    if (!shader) return

    const density = sketch.pixelDensity()
    const width = sketch.width * density
    const height = sketch.height * density

    sketch.shader(shader)
    shader.setUniform('uResolution', [width, height])
    shader.setUniform('uTime', this.time)
    shader.setUniform('uLow', this.levels.low)
    shader.setUniform('uMid', this.levels.mid)
    shader.setUniform('uHigh', this.levels.high)
    shader.setUniform('uHorizon', HORIZON_UV)
    shader.setUniform('uMotion', this.motion)
    shader.setUniform('uEyeHeight', EYE_HEIGHT)
    shader.setUniform('uRipples', this.rippleBuffer)
    shader.setUniform('uRippleCount', this.rippleCount)
    shader.setUniform('uMoonDir', this.moonDirection(sketch.width / sketch.height))

    // 板は標準の行列変換で置く。フラグメント側は gl_FragCoord から座標を
    // 作るので、多少はみ出していても絵はずれない。少し大きめにして
    // 丸め誤差で端が 1px 欠けるのを防ぐ
    sketch.plane(sketch.width * 1.02, sketch.height * 1.02)
  }

  /**
   * 月のある方向。
   *
   * 「画面のここに月を置きたい」を、視線と同じ作り方で方向ベクトルに直す。
   * シェーダー側は方向同士の角度で月を描くので、水面の反射から見上げた時も
   * 同じ月が正しい位置に写る。
   */
  private moonDirection(aspect: number): [number, number, number] {
    const x = (this.moonX - 0.5) * aspect
    const y = MOON_UV_Y - HORIZON_UV
    const length = Math.hypot(x, y, 1)
    return [x / length, y / length, -1 / length]
  }
}
