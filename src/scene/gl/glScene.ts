import p5 from 'p5'
import type { Levels } from '../../core/levels.ts'
import { opacityRatio, progress, radiusRatio, RippleField } from '../ripples.ts'
import { packWaveRing, WAVE_RING_POINTS } from '../waveSphere.ts'
import { EYE_HEIGHT, HORIZON_UV, moonDirection, waterPointAt } from './camera.ts'
import { QualityGovernor } from './quality.ts'
import bloomSource from './shaders/bloom.frag.glsl?raw'
import compositeSource from './shaders/composite.frag.glsl?raw'
import sceneSource from './shaders/scene.frag.glsl?raw'
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

/** シェーダーが一度に受け取れる波紋の数。scene.frag.glsl の MAX_RIPPLES と揃える */
const MAX_RIPPLES = 12

/** 波紋の広がりきった半径（ワールド単位） */
const RIPPLE_MAX_RADIUS = 0.85

/**
 * 滲みを作る面の粗さ。1 が原寸で、2 なら縦横それぞれ半分。
 *
 * ぼかした結果しか使わないので粗くてよく、描く面積が 1/4 で済む。
 */
const BLOOM_DOWNSCALE = 2

/** 滲みをどれくらい広げるか（元絵の画素数） */
const BLOOM_RADIUS = 26

/**
 * この端末で描けるか。
 *
 * シェーダーを GLSL ES 3.00 で書いているので WebGL2 が要る。無い環境では
 * シェーダーのコンパイルが通らず、画面が黙って真っ暗になる。
 * 描き始める前に確かめて、伝えられるようにしておく。
 *
 * ただしこれは足切りでしかない。uniform の本数や精度など、このシェーダー
 * 固有の理由で落ちることもあるので、描く側でも失敗を拾う（onError）。
 */
export function isSceneSupported(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (gl === null) return false
    // 確かめるためだけに取ったコンテキスト。同時に持てる数には上限があるので返す
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

export class GlWaterScene {
  /**
   * 描けなくなった時に一度だけ呼ばれる。
   *
   * シェーダーのコンパイルは、キャンバスができてから最初に描く時まで走らない。
   * つまり「起動には成功したが描けない」があり得る。黙って真っ暗のままに
   * しないための出口。
   */
  onError: ((message: string) => void) | null = null

  private readonly instance: p5
  private readonly container: HTMLElement
  private readonly motion: number
  private readonly random: () => number
  private readonly quality: QualityGovernor

  private sceneShader: p5.Shader | null = null
  private bloomShader: p5.Shader | null = null
  private compositeShader: p5.Shader | null = null

  /** シーンを一度ここへ描く。滲みを作るには、出来上がった絵が要る */
  private sceneBuffer: p5.Framebuffer | null = null
  /** 明るいところだけを集めてぼかした面。原寸より粗い */
  private bloomBuffer: p5.Framebuffer | null = null

  /**
   * 描く時に読む音の強さ。
   *
   * 呼び出し側から渡されたオブジェクトを持たずに、値を写している。
   * 向こうは毎フレーム同じオブジェクトを書き換えて使い回しているので、
   * 参照で持つと「いつ読むか」に絵が左右される。
   */
  private readonly levels: Levels = { low: 0, mid: 0, high: 0 }

  /**
   * 球のまわりを一周する波形。シェーダーへ渡す形に畳んだもの。
   *
   * levels と同じで、渡された配列は持たずに値を写す。向こうは毎フレーム同じ
   * 配列を書き換えて使い回しているので、参照で持つと「いつ読むか」に絵が左右される。
   */
  private readonly waveRing = new Float32Array(WAVE_RING_POINTS)

  private readonly ripples = new RippleField()
  /** 波紋をシェーダーへ渡すための入れ物。毎フレーム作り直さず、詰め替える */
  private readonly rippleBuffer = new Float32Array(MAX_RIPPLES * 4)
  private rippleCount = 0

  /** 月の横位置（0..1）。ゆっくり漂う */
  private moonX = 0.5

  private lastFrameMs: number | null = null
  /** 一度描けなくなったら、それ以上は試さない */
  private broken = false
  private disposed = false

  /**
   * 波の位相に使う時刻（秒）。
   *
   * 速さが音で変わるものは、時刻に係数を掛けてはいけない。sin(t * k) の k を
   * 動かすと t が大きいほど位相が飛び、数分後にはただのノイズになる。
   * 毎フレームぶんだけ足して積み上げれば、速さを変えても位相は連続する。
   */
  private time = 0

  /** 月が漂った量（秒）。時刻に係数を掛けないのは上と同じ理由 */
  private moonDrift = 0

  constructor(
    container: HTMLElement,
    options: { random?: () => number; reducedMotion?: boolean } = {},
  ) {
    this.container = container
    this.random = options.random ?? Math.random
    this.motion = options.reducedMotion ? 0.3 : 1
    this.quality = new QualityGovernor(window.devicePixelRatio || 1)

    this.instance = new p5((sketch: p5) => {
      sketch.setup = () => {
        const size = this.viewportSize()
        const canvas = sketch.createCanvas(size.width, size.height, sketch.WEBGL)
        // 板を貼るだけなので、輪郭線は要らない
        sketch.noStroke()
        sketch.pixelDensity(this.quality.density)

        this.sceneShader = sketch.createShader(vertexSource, sceneSource)
        this.bloomShader = sketch.createShader(vertexSource, bloomSource)
        this.compositeShader = sketch.createShader(vertexSource, compositeSource)

        // 全面の板 1 枚しか描かないので、深度も MSAA も要らない。
        // Safari は antialias の既定が true なので、黙っていると
        // マルチサンプルの解決ぶんだけ損をする（しかも density を
        // 落とす必要が出るのは、まさにその手の端末）
        const options = { antialias: false, depth: false } as const
        this.sceneBuffer = sketch.createFramebuffer(options)
        this.bloomBuffer = sketch.createFramebuffer({
          ...options,
          ...this.bloomSize(sketch.width, sketch.height),
        })

        // 音に反応する絵そのものは、支援技術には読めない。何が映っているかを
        // 言葉で置いておく
        canvas.elt.setAttribute('role', 'img')
        canvas.elt.setAttribute('aria-label', '音に反応して揺れる水面と、その反射')

        sketch.noLoop()
      }

      sketch.draw = () => this.render(sketch)
    }, container)
  }

  /** 置き場所の大きさ。生成時とリサイズ時で基準を揃える */
  private viewportSize(): { width: number; height: number } {
    return {
      width: this.container.clientWidth || window.innerWidth,
      height: this.container.clientHeight || window.innerHeight,
    }
  }

  /** 表示サイズに合わせてキャンバスを取り直す */
  resize(): void {
    if (this.disposed) return

    const { width, height } = this.viewportSize()
    if (width === this.instance.width && height === this.instance.height) return

    // 第 3 引数の true は「今すぐ描き直さなくてよい」の意味。省くと p5 が
    // ここで 1 回描いてしまい、直後の draw() と合わせて 3 パスを二重に走らせる
    this.instance.resizeCanvas(width, height, true)
    this.syncBloomBuffer(width, height)
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

  /**
   * 1 フレーム描く。
   *
   * @param levels 帯域ごとの強さ（水面と空が読む）
   * @param wave 時間領域の波形 -1..1（球の表面が読む）
   * @param nowMs 今の時刻
   */
  draw(levels: Levels, wave: Float32Array, nowMs: number): void {
    if (this.broken || this.disposed) return

    // タブが裏に回っていた等で大きく飛んだ時は、進める時間を頭打ちにする
    // （そのまま使うと波の位相が飛ぶ）
    const deltaMs = this.lastFrameMs === null ? 0 : Math.min(nowMs - this.lastFrameMs, 100)
    this.lastFrameMs = nowMs
    const deltaSec = (deltaMs / 1000) * this.motion

    // 高域が強いほど水面のきらめきが速くなる
    this.time += deltaSec * (0.6 + levels.high * 1.4)
    this.moonDrift += deltaSec
    this.moonX = 0.5 + Math.sin(this.moonDrift * 0.04) * 0.07

    this.ripples.prune(nowMs)
    this.packRipples(nowMs)
    this.applyQuality(deltaMs)

    this.levels.low = levels.low
    this.levels.mid = levels.mid
    this.levels.high = levels.high

    packWaveRing(wave, this.time, this.waveRing)

    // p5 2.x の redraw は async。中で投げられたものは reject として出てくるので、
    // ここでも拾わないと unhandled rejection が毎フレーム積み上がる
    void Promise.resolve(this.instance.redraw()).catch((error: unknown) => this.fail(error))
  }

  /**
   * p5 と、それが握っている GPU 側の資源を畳む。
   *
   * ページを離れる時はブラウザが片付けるので実害は薄いが、開発中の
   * ホットリロードでは main.ts が何度も走り、そのたびに WebGL の
   * コンテキストが積み上がる（同時に持てる数には上限がある）。
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.instance.remove()
  }

  /** 描くのが追いつかなくなっていたら、絵の細かさを 1 段落とす */
  private applyQuality(deltaMs: number): void {
    const density = this.quality.sample(deltaMs)
    if (density === null) return
    this.instance.pixelDensity(density)
    this.syncBloomBuffer(this.instance.width, this.instance.height)
  }

  private bloomSize(width: number, height: number): { width: number; height: number } {
    return {
      width: Math.max(1, Math.ceil(width / BLOOM_DOWNSCALE)),
      height: Math.max(1, Math.ceil(height / BLOOM_DOWNSCALE)),
    }
  }

  /**
   * 滲み用の面を合わせ直す。
   *
   * シーン用は大きさを指定していないのでキャンバスに自動で追従するが、
   * こちらは自前の大きさを持つぶん自動追従から外れる。**細かさ（density）も
   * 外れる**ので、そちらも一緒に伝える。忘れると、画質を落としたのに
   * 滲みだけ元の細かさで走り続け、しかも滲みの見かけの太さが変わる。
   */
  private syncBloomBuffer(width: number, height: number): void {
    const buffer = this.bloomBuffer
    if (!buffer) return
    const size = this.bloomSize(width, height)
    buffer.pixelDensity(this.quality.density)
    buffer.resize(size.width, size.height)
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

      const point = waterPointAt(ripple.x, ripple.depth, aspect)
      const offset = 4 * count

      this.rippleBuffer[offset] = point.x
      this.rippleBuffer[offset + 1] = point.z
      // 遠くの波紋も見えるように、隔たりぶんだけ大きさを持ち上げる。
      // 実際の水面では遠い輪ほど小さく見えるが、それだと打点が届かない
      this.rippleBuffer[offset + 2] =
        radiusRatio(t) *
        RIPPLE_MAX_RADIUS *
        (0.6 + ripple.strength * 0.8) *
        (1 + point.forward * 0.16)
      this.rippleBuffer[offset + 3] = amplitude

      count++
      if (count >= MAX_RIPPLES) break
    }

    this.rippleCount = count
  }

  /**
   * p5 の draw から呼ばれる。三度に分けて描く。
   *
   *   1. シーンを面へ描く
   *   2. その明るいところだけを集め、粗い面でぼかす
   *   3. 二つを重ねて画面へ出す
   *
   * 滲みを作るには一度出来上がった絵が要るので、直接画面へは描けない。
   */
  private render(sketch: p5): void {
    const scene = this.sceneShader
    const bloom = this.bloomShader
    const composite = this.compositeShader
    const sceneBuffer = this.sceneBuffer
    const bloomBuffer = this.bloomBuffer
    if (this.broken || !scene || !bloom || !composite || !sceneBuffer || !bloomBuffer) return

    // シェーダーが実際に組み立てられるのはここ。落ちるならこの中で落ちる
    try {
      const density = sketch.pixelDensity()

      sceneBuffer.begin()
      sketch.shader(scene)
      scene.setUniform('uResolution', [sketch.width * density, sketch.height * density])
      scene.setUniform('uTime', this.time)
      scene.setUniform('uLow', this.levels.low)
      scene.setUniform('uMid', this.levels.mid)
      scene.setUniform('uHigh', this.levels.high)
      scene.setUniform('uHorizon', HORIZON_UV)
      scene.setUniform('uMotion', this.motion)
      scene.setUniform('uEyeHeight', EYE_HEIGHT)
      scene.setUniform('uWave', this.waveRing)
      scene.setUniform('uRipples', this.rippleBuffer)
      scene.setUniform('uRippleCount', this.rippleCount)
      scene.setUniform('uMoonDir', moonDirection(this.moonX, this.aspect()))
      // ここだけ板をわずかに広げる。この段は gl_FragCoord から座標を作るので
      // はみ出しても絵はずれず、丸め誤差で端に隙間ができるのだけを防げる
      sketch.plane(sceneBuffer.width * 1.02, sceneBuffer.height * 1.02)
      sceneBuffer.end()

      bloomBuffer.begin()
      sketch.shader(bloom)
      bloom.setUniform('uScene', sceneBuffer)
      bloom.setUniform('uRadius', BLOOM_RADIUS)
      // 以降の段は texCoord でテクスチャを読む。板を広げると読む位置まで
      // 一緒に広がって絵が拡大されるので、ここは寸法どおりに張る
      sketch.plane(bloomBuffer.width, bloomBuffer.height)
      bloomBuffer.end()

      sketch.shader(composite)
      composite.setUniform('uScene', sceneBuffer)
      composite.setUniform('uBloom', bloomBuffer)
      // 中域が厚いほど光が溢れる
      composite.setUniform('uBloomStrength', 0.55 + this.levels.mid * 0.8)
      sketch.plane(sketch.width, sketch.height)
    } catch (error) {
      this.fail(error)
      return
    }

  }

  /** 画面の横 / 縦 */
  private aspect(): number {
    return this.instance.width / Math.max(1, this.instance.height)
  }

  /** 描けなかった。理由を一度だけ伝えて、以降は試さない */
  private fail(error: unknown): void {
    if (this.broken) return
    this.broken = true
    console.error('[introspection-art] 描画を続けられません', error)
    this.onError?.('この端末では絵を描けませんでした')
  }
}
