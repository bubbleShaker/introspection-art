/**
 * 色。夜明け前の水辺を想定した、青と紫のあいだの暗い階調。
 *
 * 反射は「元の光景より暗く、少し青に寄る」ので、空と水で別の階調を持つ。
 */
export const PALETTE = {
  /** 空: 天頂 → 水平線 */
  skyTop: '#04060f',
  skyHorizon: '#18243f',

  /** 水: 水平線際 → 手前 */
  waterNear: '#0a1122',
  waterFar: '#02030a',

  /** 月とその暈（かさ） */
  moonCore: 'rgba(228, 238, 255, 0.95)',
  moonEdge: 'rgba(146, 176, 255, 0.20)',
  haloEdge: 'rgba(120, 150, 235, 0.10)',

  /** 漂う光の粒 */
  particle: 'rgba(214, 232, 255, 1)',

  /** 波紋と水面のきらめき */
  ripple: 'rgba(150, 196, 255, 1)',

  /** 水平線のハイライト */
  horizon: 'rgba(178, 206, 255, 1)',
} as const

/** 透明色。グラデーションの端を消すのに使う */
export const TRANSPARENT = 'rgba(0, 0, 0, 0)'
