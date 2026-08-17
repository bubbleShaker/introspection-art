#version 300 es
precision highp float;

// 水面と反射。ピクセルごとに視線を 1 本飛ばして色を決める。
//
//       ＼      ← 空へ抜ける視線 : skyColor(rd)
//        ＼
//   目 ●──────── 水平線
//        ／＼
//       ／  ＼  ← 水面に当たる視線
//   ～～～～～～～ 水面 (y = 0)
//
// 肝は skyColor(dir) を空と反射で共用していること。水面の一点で法線を求め、
// 視線を反射させ、その方向の空を同じ関数で引く。転写ではなく計算なので、
// 空で起きたことは必ず水面にも現れる。

uniform vec2 uResolution;
/** 秒。フレーム差分を積み上げたもの（音で速さが変わっても位相が飛ばない） */
uniform float uTime;
/** 音の三帯域。0..1 */
uniform float uLow;
uniform float uMid;
uniform float uHigh;
/** 月のある方向（正規化済み） */
uniform vec3 uMoonDir;
/** 水平線の高さ。uv 系（画面中央が 0、上が正、縦の半分が 0.5） */
uniform float uHorizon;
/** 動きの控えめさ。prefers-reduced-motion で小さくなる */
uniform float uMotion;

out vec4 fragColor;

// ---- 色 --------------------------------------------------------------------

const vec3 SKY_TOP     = vec3(0.016, 0.024, 0.059);  // #04060f
const vec3 SKY_HORIZON = vec3(0.094, 0.141, 0.247);  // #18243f
/** 手前の水。視線が立って底の暗さがそのまま出る */
const vec3 WATER_DEEP  = vec3(0.006, 0.010, 0.030);
/** 水平線寄りの水。水の層を斜めに長く見るので、わずかに明るい */
const vec3 WATER_FAR   = vec3(0.020, 0.032, 0.062);
const vec3 MOON_TINT   = vec3(0.87, 0.92, 1.00);

// ---- 目の高さと視野 --------------------------------------------------------

/**
 * 水面からの目の高さ。波の周期はワールド単位で決めるので、この値が
 * 「どれくらいの大きさの波を見ているか」の基準になる。
 */
const float EYE_HEIGHT = 1.0;

/**
 * 水面の交点を求める距離の上限。
 *
 * 水平線ちょうどでは距離が無限に飛び、そのまま sin に入れると float の
 * 精度が尽きて模様が壊れる。どのみち遠方の波は下の lod で消えるので、
 * 手前に引き寄せてしまってよい。
 */
const float MAX_DISTANCE = 900.0;

// ---- 空 --------------------------------------------------------------------

/** 月の見かけの大きさ（半径・ラジアン） */
const float MOON_ANGLE = 0.030;

/**
 * ある方向を見たときの空の色。
 *
 * blur は「その方向がどれだけ暴れているか」（ラジアン）。空を直接見る時は 0、
 * 水面の反射として引く時は、その 1 ピクセルに収まりきらなかった細かい波の
 * ぶんが入る。月は blur のぶんだけ広がり、広がったぶんだけ薄くなる。
 *
 * これが遠景のちらつきを止めている。細かい波を消すだけだと遠くの水面は
 * ただの鏡になってしまうが、消した波の暴れを光の広がりへ振り替えると、
 * 「遠くの月の道はぼんやり滲む」という見え方になる。
 */
vec3 skyColor(vec3 dir, float blur) {
  // 水平線際が明るく、天頂へ向かって沈む。0.42 乗にすると、明るさが
  // 水平線のすぐ上に集まって空が高く見える
  float up = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(SKY_HORIZON, SKY_TOP, pow(up, 0.42));

  // 月。中域が厚いほどわずかに膨らみ、暈も強くなる
  float ang = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));
  float radius = MOON_ANGLE * (1.0 + uMid * 0.22) + blur;
  // 広がったぶんは薄める。同じ光の量が広い面積へ散る
  float spread = MOON_ANGLE / radius;

  // 芯。1 をはるかに超える値を入れる。下のトーンマップで白へ張りつき、
  // 縁だけが滲みへなだらかに落ちる（そのまま 1.0 にすると灰色の円盤になる）
  float disc = 1.0 - smoothstep(radius * 0.86, radius, ang);
  // すぐ外側の滲み
  float bleed = exp(-ang / (0.038 + blur)) * 2.4 * spread;
  // 遠くまで届く暈。空全体を底上げするので、反射にもそのまま乗る
  float halo = exp(-ang * 2.2) * (0.13 + uMid * 0.17);

  col += MOON_TINT * (disc * 14.0 * spread * spread + bleed + halo);

  // 水平線際の霞。空と水の境目を溶かして、切り取ったような硬さを消す
  float haze = exp(-max(dir.y, 0.0) * 22.0) * (0.05 + uMid * 0.05);
  col += vec3(0.34, 0.48, 0.80) * haze;

  return col;
}

// ---- 水 --------------------------------------------------------------------

/** 重ねる波の数。多いほど水面が細かく砕ける */
const int WAVE_COUNT = 9;

/** 消した細かい波を、光の広がりへどれだけ振り替えるか */
const float BLUR_GAIN = 0.24;

/**
 * 波の傾き（法線）と、そこで捨てた細かさ（blur）。
 *
 * 高さ場そのものは要らない。要るのはその勾配なので、波の式を解析的に
 * 微分した形で直接求める。
 *
 * 波は正弦波そのものではなく、((sin+1)/2)^2 で尖らせている。正弦波のままだと
 * 山と谷が同じ形になり、水よりゼリーに見える。二乗すると山が細く立ち、
 * 谷が広く平らになって、水面らしい非対称さが出る。
 *
 * dist で細かい波を落としているのが要点。遠方は 1 ピクセルに何十もの波が
 * 入るので、そのまま描くと水平線際が白くちらつく。ただ消すだけだと遠くが
 * ただの鏡になるので、消したぶんは blur として持ち帰り、月の像を広げるのに使う。
 */
vec3 waterSurface(vec2 p, float dist, out float blur) {
  float lod = 1.0 / (1.0 + dist * 0.16);
  // 振幅は月の道の広がりを決める。波が立つほど月を返す面が増え、
  // 光の道が手前へ向かって三角形に開く
  float amp = 0.150 * (0.45 + uLow * 1.30) * uMotion;
  float freq = 0.75;
  float speed = 0.90;
  float ang = 0.0;
  vec2 grad = vec2(0.0);
  float lost = 0.0;

  for (int i = 0; i < WAVE_COUNT; i++) {
    vec2 dir = vec2(cos(ang), sin(ang));
    // 細かい波ほど遠方で強く削る
    float detail = mix(1.0, lod, float(i) / float(WAVE_COUNT - 1));
    float phase = dot(p, dir) * freq + uTime * speed;

    // h = amp * ((sin(phase) + 1) / 2)^2 を phase で微分したもの
    float slope = (sin(phase) + 1.0) * cos(phase) * 0.5;

    grad += dir * slope * amp * freq * detail;
    // 削ったぶんの暴れ。これが遠景の滲みになる
    lost += amp * freq * (1.0 - detail);

    // 黄金角ずつ回す。方向が揃って格子模様に見えるのを避ける
    ang += 2.39996;
    freq *= 1.68;
    amp *= 0.71;
    speed *= 1.28;
  }

  blur = lost * BLUR_GAIN;
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

/**
 * フレネル反射率（Schlick 近似）。
 *
 * これ 1 本で奥行きが出る。遠くの水面は視線が浅く当たるので鏡のように空を
 * 映し、手前は視線が立って水の底の色が出る。今まで depth の累乗で手作業に
 * 作っていたものが、ここから自動的に出てくる。
 */
float fresnel(vec3 view, vec3 normal) {
  float base = 1.0 - clamp(dot(view, normal), 0.0, 1.0);
  return 0.02 + 0.98 * pow(base, 5.0);
}

// ---- 仕上げ ----------------------------------------------------------------

/** 暗いグラデーションに出る縞（バンディング）を、1/255 未満の揺らぎで散らす */
float dither(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  // 画面中央を原点にし、縦で正規化する。横長でも縦の見え方が変わらない
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // 視線。uv.y が uHorizon のところで水平になる
  vec3 rd = normalize(vec3(uv.x, uv.y - uHorizon, -1.0));
  vec3 col;

  if (rd.y >= 0.0) {
    col = skyColor(rd, 0.0);
  } else {
    float dist = min(EYE_HEIGHT / -rd.y, MAX_DISTANCE);
    vec3 hit = vec3(0.0, EYE_HEIGHT, 0.0) + rd * dist;

    float blur;
    vec3 normal = waterSurface(hit.xz, dist, blur);

    vec3 reflected = reflect(rd, normal);
    // 波が急なところでは反射が下を向く。水面下は写せないので折り返す
    reflected.y = abs(reflected.y);

    // 水そのものの色。手前ほど視線が立って底の暗さが出る
    vec3 body = mix(WATER_FAR, WATER_DEEP, clamp(1.0 / (1.0 + dist * 0.5), 0.0, 1.0));

    col = mix(body, skyColor(normalize(reflected), blur), fresnel(-rd, normal));
  }

  // 明るいところを圧縮する。月の芯が真っ白に潰れず、光が丸く残る
  col = col / (1.0 + col);

  // 四隅を落として、視線を中央の光の柱へ集める
  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - dot(q, q) * 0.95;

  col += (dither(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
