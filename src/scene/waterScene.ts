import type { Levels } from '../audio/bands.ts'
import { PALETTE, TRANSPARENT } from './palette.ts'
import { advanceParticles, particleBrightness, seedParticles, type Particle } from './particles.ts'
import { progress, opacityRatio, radiusRatio, RippleField } from './ripples.ts'

/**
 * 水面と反射。
 *
 * 作り方の骨は「空を別のキャンバスに一度描き、それを下半分へ
 * 横方向にずらしながら転写する」というもの。反射を独立に描き直すのではなく
 * 元の光景を写すので、空で起きたことは必ず水面にも現れる。
 *
 *   オフスクリーン(空) ─┬→ 上半分へそのまま
 *                       └→ 下半分へ、水平スライスごとに横ずらし + 減衰
 *
 * 転写を 'lighter'（加算）で行っているのは、暗い夜空の部分はほとんど
 * 何も足さず、月や光の粒だけが水面に滲み出るため。アルファ合成だと
 * 水の深い色が反射の暗部で上書きされて濁る。
 */

/** 水平線の高さ（画面高に対する比）。空を少なめにして水に語らせる */
const HORIZON_RATIO = 0.42

/** 反射の縦の詰まり具合。1 未満だと遠近がついて奥行きが出る */
const REFLECTION_COMPRESS = 0.94

/**
 * 転写するスライスの高さ(デバイス px)。
 *
 * ここを細かくするほど、隣り合う行のずれが独立に見えて水面が砕ける。
 * 光の柱（月の像が縦に散らばって見えるあれ）はこのズレの粗さから生まれる。
 */
const SLICE_PX = 2

/** 描画サイズの基準。この幅を 1.0 として各種の大きさを決める */
const REFERENCE_SIZE = 900

export class WaterScene {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly sky: HTMLCanvasElement
  private readonly skyCtx: CanvasRenderingContext2D
  /** 反射に使う、半分の解像度でぼかした空 */
  private readonly mirror: HTMLCanvasElement
  private readonly mirrorCtx: CanvasRenderingContext2D

  private readonly particles: Particle[]
  private readonly ripples = new RippleField()
  private readonly random: () => number

  private width = 0
  private height = 0
  private horizonY = 0
  private dpr = 1
  /** 解像度に依らず同じ見た目にするための倍率 */
  private unit = 1
  /** 月の横位置（0..1）。ゆっくり漂う */
  private moonX = 0.5

  private lastFrameMs: number | null = null

  constructor(canvas: HTMLCanvasElement, random: () => number = Math.random) {
    const ctx = canvas.getContext('2d')
    const sky = document.createElement('canvas')
    const skyCtx = sky.getContext('2d')
    const mirror = document.createElement('canvas')
    const mirrorCtx = mirror.getContext('2d')
    if (!ctx || !skyCtx || !mirrorCtx) throw new Error('2D コンテキストを取得できませんでした')

    this.canvas = canvas
    this.ctx = ctx
    this.sky = sky
    this.skyCtx = skyCtx
    this.mirror = mirror
    this.mirrorCtx = mirrorCtx
    this.random = random
    this.particles = seedParticles(180, random)
    this.resize()
  }

  /** 表示サイズに合わせてバッキングストアを取り直す */
  resize(): void {
    // 高 DPI では素直に倍率を上げると描画量が跳ねる。2 で頭打ちにする
    this.dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cssWidth = this.canvas.clientWidth || window.innerWidth
    const cssHeight = this.canvas.clientHeight || window.innerHeight

    this.width = Math.max(1, Math.round(cssWidth * this.dpr))
    this.height = Math.max(1, Math.round(cssHeight * this.dpr))
    this.canvas.width = this.width
    this.canvas.height = this.height

    this.horizonY = Math.round(this.height * HORIZON_RATIO)
    this.unit = Math.min(this.width, this.height) / REFERENCE_SIZE

    this.sky.width = this.width
    this.sky.height = Math.max(1, this.horizonY)

    // 反射元は半分の解像度で持つ。縮小そのものが軽いぼかしになるうえ、
    // 毎フレームかけるブラーの対象が 1/4 の面積で済む
    this.mirror.width = Math.max(1, Math.ceil(this.width / 2))
    this.mirror.height = Math.max(1, Math.ceil(this.horizonY / 2))
  }

  /**
   * 波紋をひとつ落とす。低域の打点や、無音時の自律的な揺らぎから呼ばれる。
   * 落ちる場所は月の下あたりに寄せる（光の柱が乱れるのが一番よく見える）。
   */
  splash(strength: number, nowMs: number): void {
    // 一様乱数を二つ足すと中央に寄った分布になる。月の真下に集めすぎず、
    // かといって画面端にばらけすぎない散り方になる
    const spread = (this.random() + this.random() - 1) * 0.34
    const x = clamp01(this.moonX + spread)
    const depth = 0.12 + this.random() ** 1.5 * 0.78
    this.ripples.spawn(x, depth, strength, nowMs)
  }

  /** 1 フレーム描く */
  draw(levels: Levels, nowMs: number): void {
    const deltaSeconds = this.lastFrameMs === null ? 0 : (nowMs - this.lastFrameMs) / 1000
    this.lastFrameMs = nowMs
    // タブが裏に回っていた等で大きく飛んだ時は動かさない（粒が瞬間移動する）
    advanceParticles(this.particles, Math.min(deltaSeconds, 0.1))
    this.ripples.prune(nowMs)

    this.moonX = 0.5 + Math.sin(nowMs * 0.00004) * 0.07

    this.drawSky(levels, nowMs)
    this.updateMirror()

    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1
    this.ctx.drawImage(this.sky, 0, 0)

    this.drawWaterBase()
    this.drawReflection(levels, nowMs)
    this.drawLightPath(levels, nowMs)
    this.drawRipples(nowMs)
    this.drawHorizonLine(levels)
    this.drawVignette()

    this.ctx.globalCompositeOperation = 'source-over'
    this.ctx.globalAlpha = 1
  }

  // ---- 空 ----------------------------------------------------------------

  private drawSky(levels: Levels, nowMs: number): void {
    const ctx = this.skyCtx
    const h = this.sky.height
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1

    const sky = ctx.createLinearGradient(0, 0, 0, h)
    sky.addColorStop(0, PALETTE.skyTop)
    sky.addColorStop(1, PALETTE.skyHorizon)
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, this.width, h)

    ctx.globalCompositeOperation = 'lighter'
    this.drawMoon(ctx, levels, h)
    this.drawParticles(ctx, levels, nowMs, h)
    this.drawHaze(ctx, levels, h)
    ctx.globalCompositeOperation = 'source-over'
  }

  /**
   * 水平線際の霞。空と水の境目を溶かして、切り取ったような硬さを消す。
   * 空に描いておくと、反射にもそのまま乗って水の奥がぼんやり明るくなる。
   */
  private drawHaze(ctx: CanvasRenderingContext2D, levels: Levels, skyHeight: number): void {
    const top = skyHeight * 0.74
    const haze = ctx.createLinearGradient(0, top, 0, skyHeight)
    haze.addColorStop(0, TRANSPARENT)
    haze.addColorStop(1, `rgba(88, 124, 204, ${0.14 + levels.mid * 0.12})`)
    ctx.globalAlpha = 1
    ctx.fillStyle = haze
    ctx.fillRect(0, top, this.width, skyHeight - top)
  }

  private drawMoon(ctx: CanvasRenderingContext2D, levels: Levels, skyHeight: number): void {
    const cx = this.moonX * this.width
    const cy = skyHeight * 0.36
    // 中域が厚いほど、光源がわずかに膨らむ
    const radius = this.unit * (30 + levels.mid * 16)

    // 遠くまで届く暈。空全体の明るさを底上げして、水面の反射にも乗る
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 11)
    halo.addColorStop(0, PALETTE.haloEdge)
    halo.addColorStop(1, TRANSPARENT)
    ctx.globalAlpha = 0.45 + levels.mid * 0.45
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, this.width, skyHeight)

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 2.6)
    core.addColorStop(0, PALETTE.moonCore)
    core.addColorStop(0.22, PALETTE.moonEdge)
    core.addColorStop(1, TRANSPARENT)
    ctx.globalAlpha = 1
    ctx.fillStyle = core
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 2.6, 0, Math.PI * 2)
    ctx.fill()
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    levels: Levels,
    nowMs: number,
    skyHeight: number,
  ): void {
    ctx.fillStyle = PALETTE.particle
    for (const p of this.particles) {
      const brightness = particleBrightness(p, nowMs, levels.high)
      ctx.globalAlpha = brightness * 0.7
      const r = this.unit * (0.7 + p.size * 1.8)
      ctx.beginPath()
      ctx.arc(p.x * this.width, p.y * skyHeight, r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  /**
   * 反射元を作り直す。
   *
   * 空をそのまま写すと、星のような小さな点が水面でも点のまま残り、
   * スライスのずれと相まって階段状の粒に見えてしまう。一度ぼかしてから
   * 写すと、点は滲んだ光になり、月の明るい塊だけが形を保つ。
   */
  private updateMirror(): void {
    const ctx = this.mirrorCtx
    ctx.clearRect(0, 0, this.mirror.width, this.mirror.height)
    ctx.filter = `blur(${Math.max(1, this.unit * 2)}px)`
    ctx.drawImage(this.sky, 0, 0, this.mirror.width, this.mirror.height)
    ctx.filter = 'none'
  }

  // ---- 水 ----------------------------------------------------------------

  private drawWaterBase(): void {
    const ctx = this.ctx
    const water = ctx.createLinearGradient(0, this.horizonY, 0, this.height)
    water.addColorStop(0, PALETTE.waterNear)
    water.addColorStop(1, PALETTE.waterFar)
    ctx.fillStyle = water
    ctx.fillRect(0, this.horizonY, this.width, this.height - this.horizonY)
  }

  /**
   * 空を下半分へ写す。
   *
   * d を水平線からの距離として、スライスごとに
   *   - 元になる空の行は d だけ上（＝上下が入れ替わる）
   *   - 横に sin 波でずらす（手前ほど大きく揺れる）
   *   - 手前ほど薄くする（遠くの水面ほど像がはっきり見える）
   * を行う。
   */
  private drawReflection(levels: Levels, nowMs: number): void {
    const ctx = this.ctx
    const waterHeight = this.height - this.horizonY
    if (waterHeight <= 0) return

    const slice = SLICE_PX
    // 低域が来るとうねりが大きくなる。無音でも 0.4 は残して水を死なせない
    const swell = 0.4 + levels.low * 1.6
    // ずらした分だけ端に隙間ができるので、あらかじめ横に伸ばして描く
    const overscan = this.unit * 150

    ctx.globalCompositeOperation = 'lighter'

    for (let d = 0; d < waterHeight; d += slice) {
      const srcTop = this.horizonY - (d + slice) * REFLECTION_COMPRESS
      if (srcTop < 0) break

      const depth = d / waterHeight
      // 揺れ幅は手前ほど大きい。1.6 乗で効かせると、水平線際が鏡のように
      // 静かなまま、手前だけが大きく崩れる
      const amplitude = Math.min(overscan, this.unit * (0.6 + depth ** 1.6 * 100) * swell)

      // 三つの波を重ねる。大きなうねり、中くらいの波、そして細かいさざ波。
      // さざ波は隣の行と大きく位相が違うので、行ごとにばらばらにずれる。
      // 月の像がこれで縦方向に砕けて、水面の光の柱になる
      const offsetX =
        Math.sin(d * 0.0085 + nowMs * 0.00055) * amplitude +
        Math.sin(d * 0.024 - nowMs * 0.0011) * amplitude * 0.6 +
        Math.sin(d * 0.41 - nowMs * 0.0055) * amplitude * 0.45

      // 反射は元の光景より暗い。粒の写り込みは薄く沈み、月だけが残る
      ctx.globalAlpha = Math.min(1, 0.62 * (1 - depth) ** 1.1 + 0.04)
      // 反射元は半分の解像度なので、切り出す座標も半分にする
      ctx.drawImage(
        this.mirror,
        0,
        srcTop / 2,
        this.mirror.width,
        slice / 2,
        offsetX - overscan,
        this.horizonY + d,
        this.width + overscan * 2,
        slice,
      )
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  /**
   * 月の下にできる光の柱。
   *
   * スライスの転写だけでは、月はただの滲んだ塊にしかならない。実際の水面では
   * 波の一つひとつが小さな鏡になり、たまたま月をこちらへ返した面だけが光る。
   * それを、行ごとに散らした短い横線の集まりとして描く。
   *
   * 柱が手前ほど広がるのは、手前の波ほど大きな角度で見えているため。
   */
  private drawLightPath(levels: Levels, nowMs: number): void {
    const ctx = this.ctx
    const waterHeight = this.height - this.horizonY
    if (waterHeight <= 0) return

    const cx = this.moonX * this.width
    const step = Math.max(2, Math.round(3 * this.dpr))
    const sway = 0.55 + levels.low * 0.85 // 低域で柱が乱れる
    const shimmer = 0.6 + levels.high * 1.4 // 高域できらめきが速くなる
    const glow = 0.75 + levels.mid * 0.7 // 中域で全体が明るむ

    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = PALETTE.horizon
    ctx.lineCap = 'round'

    // 行ごとに位相をずらすための係数。互いに整数倍でない値を選んで、
    // 何行かおきに模様が繰り返すのを避ける
    const strands = [1, 1.73, 2.61, 3.44]
    const thin = Math.max(1, step * 0.7)
    const halo = Math.max(2, step * 2.6)

    for (let d = 0; d < waterHeight; d += step) {
      const depth = d / waterHeight
      // 手前ほど大きく開く。光の柱が三角形に見えるのはこのため
      const halfWidth = this.unit * (16 + depth ** 1.35 * 430)
      // 遠いほど密で明るく、手前ほど疎になって消えていく。
      // ただし水平線のすぐ際は幅が無いぶん光が固まって板に見えるので、
      // そこだけは立ち上がりを作って滲ませる
      const falloff = (1 - depth) ** 1.25 * Math.min(1, depth / 0.05)

      for (let k = 0; k < strands.length; k++) {
        const seed = d * strands[k] + k * 137
        const offset =
          (Math.sin(seed * 0.37 + nowMs * 0.004) * 0.5 +
            Math.sin(seed * 1.13 - nowMs * 0.0027) * 0.34 +
            Math.sin(seed * 2.7 + nowMs * 0.0061) * 0.16) *
          halfWidth *
          sway

        // 柱の中心から外れた光ほど弱い。2 乗にすると縁が柔らかくぼける
        const ratio = Math.min(1, Math.abs(offset) / halfWidth)
        const spread = 1 - ratio * ratio
        // 3 乗して、光っている瞬間を尖らせる。常時光っていると水に見えない
        const twinkle = Math.max(0, Math.sin(seed * 0.9 + nowMs * 0.005 * shimmer)) ** 3
        const alpha = falloff * spread * twinkle * glow * 1.4
        if (alpha <= 0.004) continue

        // 長さも揃えない。同じ長さの棒が並ぶと縫い目のように見える
        const length = this.unit * (5 + depth * 30) * (0.5 + Math.abs(Math.sin(seed * 0.61)))
        const y = this.horizonY + d
        const left = cx + offset - length / 2
        const right = cx + offset + length / 2

        // 太く薄い一本を先に置いて滲みを作り、その上に細く明るい芯を重ねる。
        // ぼかしフィルタを毎フレームかけずに、光が滲んで見える
        ctx.globalAlpha = Math.min(1, alpha * 0.28)
        ctx.lineWidth = halo
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(right, y)
        ctx.stroke()

        ctx.globalAlpha = Math.min(1, alpha)
        ctx.lineWidth = thin
        ctx.beginPath()
        ctx.moveTo(left, y)
        ctx.lineTo(right, y)
        ctx.stroke()
      }
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  private drawRipples(nowMs: number): void {
    const ctx = this.ctx
    const waterHeight = this.height - this.horizonY
    ctx.globalCompositeOperation = 'lighter'
    ctx.strokeStyle = PALETTE.ripple

    for (const ripple of this.ripples.items) {
      const t = progress(ripple, nowMs)
      const alpha = opacityRatio(t) * ripple.strength
      if (alpha <= 0.003) continue

      const cx = ripple.x * this.width
      const cy = this.horizonY + ripple.depth * waterHeight
      const maxRadius = this.unit * (70 + ripple.strength * 150)
      // 水面を斜めから見ているので、円は横に潰れた楕円になる。
      // 手前（depth が大きい）ほど潰れ方が緩む
      const flatten = 0.09 + ripple.depth * 0.20

      this.strokeRing(cx, cy, radiusRatio(t) * maxRadius, flatten, alpha, 1 - t)
      // 少し遅れて内側からもう一輪。単輪より水らしくなる
      const inner = Math.max(0, t - 0.14)
      if (inner > 0) {
        this.strokeRing(cx, cy, radiusRatio(inner) * maxRadius, flatten, alpha * 0.55, 1 - inner)
      }
    }

    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }

  private strokeRing(
    cx: number,
    cy: number,
    radius: number,
    flatten: number,
    alpha: number,
    thickness: number,
  ): void {
    const ctx = this.ctx
    ctx.globalAlpha = alpha
    ctx.lineWidth = Math.max(1, this.unit * 2.4 * thickness)
    ctx.beginPath()
    ctx.ellipse(cx, cy, radius, radius * flatten, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  /** 水平線。月の真下が一番明るく、両端へ消えていく */
  private drawHorizonLine(levels: Levels): void {
    const ctx = this.ctx
    const gradient = ctx.createLinearGradient(0, 0, this.width, 0)
    const left = clamp01(this.moonX - 0.36)
    const right = clamp01(this.moonX + 0.36)
    const peak = `rgba(178, 206, 255, ${0.35 + levels.mid * 0.4})`

    gradient.addColorStop(0, TRANSPARENT)
    gradient.addColorStop(left, TRANSPARENT)
    gradient.addColorStop(clamp01(this.moonX), peak)
    gradient.addColorStop(right, TRANSPARENT)
    gradient.addColorStop(1, TRANSPARENT)

    const thickness = Math.max(1, this.unit * 1.6)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = gradient
    ctx.fillRect(0, this.horizonY - thickness / 2, this.width, thickness)
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 四隅を落として、視線を中央の光の柱に集める */
  private drawVignette(): void {
    const ctx = this.ctx
    const cx = this.width / 2
    const cy = this.height / 2
    const outer = Math.hypot(cx, cy)
    const vignette = ctx.createRadialGradient(cx, cy, outer * 0.42, cx, cy, outer)
    vignette.addColorStop(0, TRANSPARENT)
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    ctx.fillStyle = vignette
    ctx.fillRect(0, 0, this.width, this.height)
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
