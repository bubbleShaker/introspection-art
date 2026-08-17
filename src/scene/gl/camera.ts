/**
 * 画面の位置と、水面上の位置の対応。
 *
 * ここは `scene.frag.glsl` の `main()` が視線を組み立てているのと同じ式を、
 * TypeScript 側から解いたもの。**片方だけ変えると波紋と月が黙ってずれる**ので、
 * 対になっていることを忘れないこと。シェーダーへは `uHorizon` と `uEyeHeight`
 * を uniform で渡していて、値の出どころはこのファイルだけにしてある。
 *
 * シェーダー側:
 *
 *     vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
 *     vec3 rd = normalize(vec3(uv.x, uv.y - uHorizon, -1.0));
 *     float dist = uEyeHeight / -rd.y;
 *     vec3 hit  = vec3(0.0, uEyeHeight, 0.0) + rd * dist;
 */

/** 水平線の高さ。uv 系（画面中央が 0、上が正、縦の半分で 0.5） */
export const HORIZON_UV = 0.08

/** 月の高さ。同じく uv 系 */
export const MOON_UV_Y = 0.35

/**
 * 水面からの目の高さ（ワールド単位）。
 *
 * 波の周期はワールド単位で決めてあるので、この値が「どれくらいの大きさの波を
 * 見ているか」の基準になる。
 */
export const EYE_HEIGHT = 1.0

/** 水平線から画面の下端までが、uv 系でどれだけあるか */
const SCREEN_BELOW_HORIZON = HORIZON_UV + 0.5

/**
 * 画面の下半分での位置を、水面上の位置へ直す。
 *
 * @param x 横位置 0..1（画面の左端が 0）
 * @param depth 水平線からの深さ 0..1（1 が画面の手前）
 * @param aspect 画面の横 / 縦
 */
export function waterPointAt(
  x: number,
  depth: number,
  aspect: number,
): { x: number; z: number; forward: number } {
  // 水平線ちょうど（depth = 0）では交点が無限に飛ぶ。少し手前で止める
  const below = Math.max(depth, 0.04) * SCREEN_BELOW_HORIZON
  // 視線が水面に届くまでの、正面方向の隔たり。
  // シェーダーの dist（目からの直線距離）とは別物で、こちらは奥行きだけ
  const forward = EYE_HEIGHT / below
  return { x: (x - 0.5) * aspect * forward, z: -forward, forward }
}

/**
 * 月のある方向（正規化済み）。
 *
 * 「画面のここに月を置きたい」を、視線と同じ作り方で方向ベクトルに直す。
 * シェーダー側は方向同士の角度で月を描くので、水面の反射から見上げた時も
 * 同じ月が正しい位置に写る。
 *
 * @param moonX 横位置 0..1
 * @param aspect 画面の横 / 縦
 */
export function moonDirection(moonX: number, aspect: number): [number, number, number] {
  const x = (moonX - 0.5) * aspect
  const y = MOON_UV_Y - HORIZON_UV
  const length = Math.hypot(x, y, 1)
  return [x / length, y / length, -1 / length]
}
