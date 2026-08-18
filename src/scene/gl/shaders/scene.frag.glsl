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
/**
 * 水面からの目の高さ。波の周期はワールド単位で決めるので、この値が
 * 「どれくらいの大きさの波を見ているか」の基準になる。
 */
uniform float uEyeHeight;

/** 同時に扱う波紋の数。溢れたぶんは古いものから捨てる（JS 側） */
const int MAX_RIPPLES = 12;

/**
 * 波紋。xy = 水面上の位置 / z = 今の半径 / w = 今の強さ。
 *
 * 半径の伸び方と薄れ方は JS 側（ripples.ts）が持っている。式が実装の
 * 都合で変わらないよう、テストのある側に残して、ここへは結果だけ届く。
 */
uniform vec4 uRipples[MAX_RIPPLES];
uniform int uRippleCount;

/** 波形の輪の点の数。waveSphere.ts の WAVE_RING_POINTS と揃える */
const int WAVE_POINTS = 128;

/**
 * 球のまわりを一周する波形。4 点ずつ vec4 に詰めてある。
 *
 * float を 128 本並べると、実装によっては uniform の本数の上限に触る。
 * JS 側（waveSphere.ts）が渡すのは 128 個並んだ平らな配列で、4 つ組に
 * 区切っているのはこの宣言の側。輪の中身の作り方は向こうが持っている。
 */
uniform vec4 uWave[WAVE_POINTS / 4];

out vec4 fragColor;

const float TAU = 6.28318530718;
const float PI  = 3.14159265359;

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
 * 水面の交点を求める距離の上限。
 *
 * 水平線ちょうどでは距離が無限に飛び、そのまま sin に入れると float の
 * 精度が尽きて模様が壊れる。どのみち遠方の波は下の lod で消えるので、
 * 手前に引き寄せてしまってよい。
 */
const float MAX_DISTANCE = 900.0;

// ---- ノイズ ----------------------------------------------------------------

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

/** 値ノイズ。格子点に置いた乱数を滑らかに繋ぐ */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // 3t^2 - 2t^3 で補間する。両端で傾きが 0 になるので、格子の継ぎ目が見えない
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float hash31(vec3 p) {
  p = fract(p * vec3(123.34, 456.21, 789.13));
  p += dot(p, p.yzx + 45.32);
  return fract((p.x + p.y) * p.z);
}

/**
 * 値ノイズの 3 次元版。球の表面に使う。
 *
 * 平面のノイズを球へ貼ると、極で必ず縮んで模様が渦を巻く。空間の側に
 * ノイズを敷いて球でくり抜けば、どこを見ても同じ細かさになる。
 */
float valueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);

  // 手前の面と奥の面をそれぞれ双線形に混ぜ、最後に奥行きで混ぜる
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

/**
 * 3 次元の fbm。段数は 3 で止めてある。
 *
 * 球の格子を押し曲げるうねりに使う（下の wireCoverage を参照）。空の fbm と
 * 同じ 5 段にすると、そこだけで 1 ピクセルあたり 40 回の hash になる。
 */
float fbm3(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += valueNoise3(p) * amp;
    p = p * 2.07 + 13.1;
    amp *= 0.5;
  }
  return sum;
}

/** 倍の細かさを半分の強さで重ねる。雲のような、大小の入れ子になった形を作る */
float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += valueNoise(p) * amp;
    // ずらしながら倍へ。ずらさないと各段の格子が同じ場所で揃ってしまう
    p = p * 2.03 + 17.3;
    amp *= 0.5;
  }
  return sum;
}

// ---- 空 --------------------------------------------------------------------

/** 月の見かけの大きさ（半径・ラジアン） */
const float MOON_ANGLE = 0.030;

/** 星の細かさ。大きいほど格子が細かい＝星が多い */
const float STAR_DENSITY = 46.0;

/** 雲の層の高さ。目の高さ（uEyeHeight）に対する比 */
const float CLOUD_HEIGHT = 26.0;

const vec3 CLOUD_SHADE = vec3(0.020, 0.028, 0.052);
const vec3 CLOUD_LIT   = vec3(0.46, 0.55, 0.78);

/**
 * 星。
 *
 * 方向を球面の格子に切り、セルごとに 1 つ置く。反射から引かれた時は
 * blur のぶんだけ溶けて消える（点光源をぼかさずに水面へ写すと、
 * 遠景が砂嵐のようにちらつく）。
 */
float stars(vec3 dir, float blur) {
  float legible = exp(-blur * 70.0);
  if (legible < 0.004) return 0.0;

  // 天頂の一点で歪む投影だが、そこは画面に入らない
  vec2 sv = vec2(atan(dir.z, dir.x), acos(clamp(dir.y, -1.0, 1.0))) * STAR_DENSITY;
  vec2 cell = floor(sv);

  float seed = hash21(cell);
  // 疎に置く。全部のセルに星があると、格子が透けて見える
  float exists = smoothstep(0.84, 0.97, seed);
  if (exists <= 0.0) return 0.0;

  vec2 pos = vec2(hash21(cell + 3.7), hash21(cell + 9.1));
  float shape = smoothstep(0.17, 0.0, length(fract(sv) - pos));

  // 高域が強いほど強く瞬く。星ごとに速さと位相を変える
  float twinkle = 0.45 + 0.55 * sin(uTime * (1.4 + seed * 4.0) + seed * 43.0);
  twinkle = mix(0.78, twinkle, 0.3 + uHigh * 0.7);

  return shape * exists * twinkle * legible;
}

/** 天の川の走る向き（帯の法線）。この向きに近い方向ほど帯から遠い */
const vec3 GALAXY_AXIS = vec3(0.62, 0.47, 0.63);

/**
 * 天の川。
 *
 * 大円に沿った帯なので、ある軸との内積が 0 に近い方向ほど濃い。
 * 濃淡は fbm で散らす。星のような点ではなく面で光るので、
 * 反射に写しても点滅しない（blur では消さず、薄めるだけでよい）。
 */
float galaxy(vec3 dir, float blur) {
  float off = dot(dir, normalize(GALAXY_AXIS));
  float band = exp(-off * off * 15.0);
  float n = fbm(vec2(atan(dir.z, dir.x) * 2.4, dir.y * 3.6) * 1.7);
  // 濃い所と抜けた所の差を強めに取ると、雲状の粒立ちが出る
  return band * (0.22 + n * n * 1.5) / (1.0 + blur * 26.0);
}

/**
 * 雲の濃さ。
 *
 * 高さ CLOUD_HEIGHT の平らな層と視線の交点でノイズを引く。低い角度ほど
 * 交点が遠くへ飛ぶので、雲が水平線際で横に潰れて層に見える。
 */
float clouds(vec3 dir, float blur) {
  float up = max(dir.y, 0.0);
  vec2 p = dir.xz * (CLOUD_HEIGHT / max(up, 0.02)) * 0.02;

  float mass = smoothstep(0.38, 0.70, fbm(p + vec2(uTime * 0.012, uTime * 0.004)));
  // 水平線のすぐ上に帯として溜め、天頂へ向かって切れていく
  float band = smoothstep(0.0, 0.05, up) * exp(-up * 2.6);
  // 水面で暴れている方向では、雲の形は残らない
  return mass * band * (1.0 - smoothstep(0.0, 0.045, blur));
}

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

  // 月からの角度。星の見え方も雲の照らされ方も、これで決まる
  float ang = acos(clamp(dot(dir, uMoonDir), -1.0, 1.0));

  // 月明かりに負けて、月のそばでは星も天の川も見えなくなる
  float darkness = smoothstep(0.10, 0.60, ang);

  // 天の川。空の背景側なので、星より先に置く
  col += vec3(0.30, 0.36, 0.58) * galaxy(dir, blur) * 0.16 * darkness;

  col += vec3(0.80, 0.86, 1.0) * stars(dir, blur) * 0.85 * darkness;

  // 月。中域が厚いほどわずかに膨らみ、暈も強くなる
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

  // 雲。まず星と空を覆って沈め、そのうえで月に向いた面だけを照らす。
  // 夜の雲は「明るいもの」ではなく「星を隠すもの」なので、順序がこうなる
  float cloud = clouds(dir, blur);
  col = mix(col, CLOUD_SHADE, cloud * 0.62);
  col += CLOUD_LIT * cloud * exp(-ang * 1.3) * (0.55 + uMid * 0.75);

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

/** 波紋の輪の細かさ。大きいほど輪が何重にも重なる */
const float RIPPLE_FREQ = 5.6;

/** 波紋の高さ。うねりに対してどれくらい立たせるか */
const float RIPPLE_AMP = 0.13;

/**
 * 波紋のぶんの傾き。
 *
 * 輪の縁（dist == 半径）を山として、その内外へ数周ぶんの波が減衰しながら
 * 続く形。中心から外へ向かう向きに傾くので、勾配は中心からの方向ベクトルに
 * 半径方向の微分を掛けたものになる。
 */
vec2 rippleGradient(vec2 p) {
  vec2 grad = vec2(0.0);

  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;

    vec4 ripple = uRipples[i];
    vec2 offset = p - ripple.xy;
    float dist = length(offset);
    // 輪の縁からの隔たり。ここが 0 の場所がいちばん高く立つ
    float edge = dist - ripple.z;
    float envelope = exp(-edge * edge * 5.0);
    if (envelope < 0.004) continue;

    // h = sin(edge * FREQ) * envelope * 強さ を dist で微分したもの。
    // envelope の変化は波そのものよりずっと緩いので、そこは無視してよい
    float slope = cos(edge * RIPPLE_FREQ) * RIPPLE_FREQ * envelope * ripple.w;
    grad += (offset / max(dist, 1e-4)) * slope * RIPPLE_AMP;
  }

  return grad;
}

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

  // 波紋を重ねる。うねりと同じく、遠いところでは細部が消える
  grad += rippleGradient(p) * lod;

  // 手前でも 0 にはしない。実際の水面には必ず目に見えないさざ波があり、
  // 完全な鏡になることはない。0 にすると、たまたま月を正面から返した
  // ひとつの面が月をそのまま映して、丸い光の塊になってしまう
  blur = lost * BLUR_GAIN + 0.006;
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

// ---- 球 --------------------------------------------------------------------
//
// 水面のすぐ上に浮かぶ、格子だけでできた球。音の波形はここに現れる。
//
// 面は持たない。緯線と経線の細い骨があるだけで、線と線の隙間からは背後の海と
// 空がそのまま透ける。波形は面の凹凸ではなく、骨組みの歪みとして現れる。
// 向こう側の線も描くので、中が空洞であることが形として分かる。
//
// 水面と同じ世界に置いてあるので、線は月を映し、フレネルで縁が光り、
// ブルームの前の段なので細い線が滲む。

/** 目からの奥行き（-z 方向） */
const float SPHERE_FORWARD = 3.6;

/**
 * 半径。
 *
 * 見かけの大きさ（uv 系）はおよそ 半径 / 奥行き になる。0.62 / 3.6 ≒ 0.17。
 *
 * 大きくしすぎると月（camera.ts の MOON_UV_Y）に触れ、水面の光の道ごと
 * 隠してしまう。今は球の頂きと月の下端が uv でおよそ 0.1 空いている。
 * 月の高さを動かす時は、こちらも一緒に見ること。
 */
const float SPHERE_RADIUS = 0.62;

/** 水面からどれだけ浮いているか。真下に映り込みが入るだけの隙間を空ける */
const float SPHERE_HOVER = 0.22;

const vec3 SPHERE_CENTER = vec3(0.0, SPHERE_HOVER + SPHERE_RADIUS, -SPHERE_FORWARD);

/** 線そのものの色。水と同じく、自分では光らず映すだけ */
const vec3 WIRE_BODY = vec3(0.008, 0.014, 0.034);

/**
 * レイと球の交差。farSide が false なら手前、true なら向こう側の交点までの距離。
 * 当たらなければ -1。
 *
 * rd は正規化済みなので、二次方程式の a が 1 になって式が短くなる。
 * 中が空洞なので、向こう側の面も描く相手になる（面のある塊だった頃は
 * 手前の交点しか要らなかった）。
 */
float sphereHit(vec3 ro, vec3 rd, float radius, bool farSide) {
  vec3 oc = ro - SPHERE_CENTER;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  float root = sqrt(h);
  float t = farSide ? -b + root : -b - root;
  return t > 0.0 ? t : -1.0;
}

/** 波形が球の半径をどれだけ膨らませるか（半径に対する割合） */
const float SPHERE_SWING = 0.12;

/** 輪の i 番目。4 点ずつ vec4 に詰めてあるので、割った先の成分を引く */
float waveSample(int i) {
  return uWave[i >> 2][i & 3];
}

/**
 * その向きの波形の値。-1..1。
 *
 * 縦軸まわりの角度（経度）で輪を引く。以前のリングが画面上の角度で輪を
 * 引いていたのと同じもので、平面が球になったぶん、輪は赤道に沿って回る。
 *
 * 真上と真下では経度が定まらないので、極へ近づくほど細める。細めないと、
 * 極の一点で輪の全部の値がぶつかって、そこだけがちらつく。
 *
 * 隣り合う 2 点を 3t^2-2t^3 で混ぜているのは、この値を微分して法線を作るため。
 * 素直な直線補間だと傾きが 128 か所で飛び、球が多面体に見える。
 */
float waveAt(vec3 q) {
  // 極では経度が定まらない。atan(0, 0) は仕様上結果が決まっておらず、
  // 実装によっては NaN が返る。下の細めは 0 を掛けるだけなので NaN は消せない
  // （NaN * 0 は NaN）。ここで先に逃がす
  float around = length(q.xz);
  if (around < 1e-6) return 0.0;

  float lon = atan(q.z, q.x) / TAU + 0.5;
  float pos = lon * float(WAVE_POINTS);

  int i0 = int(pos) % WAVE_POINTS;
  int i1 = (i0 + 1) % WAVE_POINTS;
  float f = fract(pos);

  float value = mix(waveSample(i0), waveSample(i1), f * f * (3.0 - 2.0 * f));
  // -1..1 に収める。JS 側は tanh に息づかいを足すので、わずかに 1 を超えて届く。
  // 下の交差判定はこの値域を前提に球の外接を決めているので、ここで頭を揃える
  value = clamp(value, -1.0, 1.0);
  // 極からの遠さ。赤道で 1、真上と真下で 0
  return value * around;
}

/** その向きでの球の半径。波形のぶんだけ膨らむ */
float sphereRadiusAt(vec3 q) {
  return SPHERE_RADIUS * (1.0 + waveAt(q) * SPHERE_SWING);
}

/**
 * 波形で膨らんだ球との交差。当たった向き（中心から見た単位ベクトル）を hitDir へ。
 * farSide を立てると、向こう側の面を取る。
 *
 * 半径が向きで変わるので、二次方程式ひとつでは解けない。輪郭の形を決めているのは
 * 「視線が中心にいちばん近づく点の向き」なので、まずそこの半径で球を切り、
 * 出てきた交点の向きでもう一度切り直す。膨らみが半径の 1 割強なら、
 * この 2 回でほぼ収まる（レイマーチせずに済む）。
 *
 * 「そもそも球に届くか」はここでは見ない。呼び元（sphereWire）が、表と裏の
 * 2 枚を引く前に一度だけ外接球で外している。
 */
float sphereSurfaceHit(vec3 ro, vec3 rd, bool farSide, out vec3 hitDir) {
  vec3 oc = ro - SPHERE_CENTER;
  // 中心から、視線がいちばん近づく点へ。輪郭はこの向きの半径で決まる
  vec3 near = oc - dot(oc, rd) * rd;
  float span = length(near);
  // 中心をまっすぐ貫く視線だけは向きが定まらない。そこは輪郭から最も遠いので、
  // どの向きを充てても輪郭は変わらない
  vec3 edgeDir = span > 1e-4 ? near / span : vec3(1.0, 0.0, 0.0);

  float t = sphereHit(ro, rd, sphereRadiusAt(edgeDir), farSide);
  if (t < 0.0) return -1.0;

  hitDir = normalize(ro + rd * t - SPHERE_CENTER);

  // 切り直した半径の方が小さいと、視線がその球を外すことがある。そこで
  // 「当たらなかった」を返すと、輪郭の内側に穴が空いて縁が二重に見える。
  // 一度当たっている以上、表面はそこにある。外れた時は 1 段目をそのまま使う
  float refined = sphereHit(ro, rd, sphereRadiusAt(hitDir), farSide);
  if (refined <= 0.0) return t;

  hitDir = normalize(ro + rd * refined - SPHERE_CENTER);
  return refined;
}

/** 経線の数。球をひと回りするあいだに何本くぐるか */
const float WIRE_MERIDIANS = 20.0;

/** 緯線の数。極から極までに何本並ぶか */
const float WIRE_PARALLELS = 12.0;

/**
 * 線の太さ。単位球の表面での幅（ラジアン）。
 *
 * 画面上の太さはここに交点までの距離が掛かって決まるが、球は動かないので
 * 見かけの太さもほぼ変わらない。
 */
const float WIRE_WIDTH = 0.010;

/** 格子を押し曲げるうねりの細かさ */
const float SPHERE_WARP_FREQ = 2.1;

/**
 * 波形が緯線をどれだけ押し上げるか。緯線 1 本ぶんの間隔に対する割合。
 *
 * 1.0 を超えると、押された緯線が隣を追い越して格子が絡まる。
 */
const float WIRE_RIB = 0.26;

/** 線の明るさ */
const float WIRE_GLOW = 0.85;

/** 月を返した線の、鋭い光の強さ */
const float WIRE_SPEC = 1.60;

/** 向こう側の線をどれだけ薄く重ねるか */
const float WIRE_BACK = 0.30;

/**
 * 格子線 1 本ぶんの濃さ。
 *
 * coord は「線がちょうど整数の位置に来る」座標、spacing はその座標 1 あたりの
 * 球面上の長さ。太さと滲みを球面上の長さで測りたいので、隔たりを一度
 * 長さへ直してから比べる。
 *
 * @param aa 滲ませる幅。0 だと smoothstep の両端が重なって結果が定まらない
 */
float wireLine(float coord, float spacing, float aa) {
  // 最寄りの線までの隔たり（座標の単位）を、球面上の長さに直す
  float d = abs(fract(coord + 0.5) - 0.5) * spacing;
  float line = 1.0 - smoothstep(WIRE_WIDTH, WIRE_WIDTH + aa, d);

  // 滲みが線の太さを超えたら、超えたぶんだけ薄める。
  //
  // 滲ませるだけだと、線は画面上でいくら細っても真芯の濃さを保ってしまう。
  // 極や輪郭のように線が潰れて重なるところで、白い塊に固まる原因になる。
  // 縮んだ絵を薄くするのは、縮小して重ねる時の当たり前の作法でもある。
  //
  // ただし消しきらない。輪郭は線がいちばん寝て潰れるところだが、そこは同時に
  // 球の丸みを見せている骨でもあるので、薄い帯として残す
  return line * mix(0.34, 1.0, min(1.0, WIRE_WIDTH * 3.0 / max(aa, 1e-5)));
}

/**
 * その向きに格子線がどれだけ掛かっているか。0..1。
 * q は中心から見た単位ベクトル、t は交点までの距離。
 *
 * 線の太さは球面上の長さで決めているので、球を斜めから見るところでは
 * 画面上でどんどん細くなり、輪郭では 1 ピクセルを割って点滅する。
 * そこで、1 ピクセルがこの面をどれだけ覆うかを距離と傾きから出し、
 * その幅で滲ませる。細りきった線は滲んで薄い帯として残る。
 *
 * 時刻に係数を掛けないこと（uTime は既にフレーム差分の積み上げで、
 * `prefers-reduced-motion` のぶんも入っている）。
 */
float wireCoverage(vec3 rd, vec3 q, float t) {
  // 1 ピクセルが、この交点で球面上に覆う長さ（単位球換算）。uv 系は縦で
  // 正規化してあるので、1 ピクセルの見込み角は 1 / uResolution.y になる
  float pixel = t / (uResolution.y * SPHERE_RADIUS);
  // 面が視線に対して寝ているほど、同じ 1 ピクセルが表面を広く覆う。
  // 輪郭では発散するので、頭を押さえる
  float aa = pixel / max(abs(dot(rd, q)), 0.12);

  // 縦軸からの遠さ。赤道で 1、真上と真下で 0
  float around = length(q.xz);

  // 座標そのものを時間で流す。格子が形を保ったまま、ゆっくり波打って巡る。
  // これが無いと、幾何のとおりの網が硬く貼りついて見える
  vec3 drift = vec3(uTime * 0.05, uTime * 0.09, uTime * 0.04);
  float swell = fbm3(q * SPHERE_WARP_FREQ + drift) - 0.5;

  // 緯線。波形のぶんだけ上下に押される。経度に沿って輪が波打つので、
  // 音の形がそのまま骨組みの歪みになる。交差判定でも同じ waveAt で球を
  // 膨らませてあるから、輪郭のうねりと線のうねりが食い違わない
  float lat = asin(clamp(q.y, -1.0, 1.0)) / PI;
  float latCoord = lat * WIRE_PARALLELS + waveAt(q) * WIRE_RIB + swell * 0.5;
  float parallels = wireLine(latCoord, PI / WIRE_PARALLELS, aa);

  // 経線。極へ寄るほど隣との間隔が詰まって潰れるので、そこは薄めて逃がす
  float lon = atan(q.z, q.x) / TAU;
  float lonCoord = lon * WIRE_MERIDIANS + swell * 0.4;
  float meridians = wireLine(lonCoord, TAU * around / WIRE_MERIDIANS, aa)
                  * smoothstep(0.06, 0.45, around);

  // 重なったところが濃くならないよう、足さずに濃い方を取る
  return max(parallels, meridians);
}

/**
 * 格子線の色。
 *
 * 水面と同じ組み立て方をしている。視線を反射させ、その方向の空を skyColor() で
 * 引き、フレネルで線そのものの色と混ぜる。同じ関数から色が来るので、
 * 球と水面はひとりでに同じ夜を映す。
 *
 * 線は球面に貼りついた細い骨なので、法線は球の向き q をそのまま使う。
 * 波形による膨らみの傾きまでは見ない（線が細く、傾きの差が出る幅が無い）。
 */
vec3 wireColor(vec3 rd, vec3 q, float surfaceBlur) {
  // 面が完全に滑らかだと、月がひとつの点に凝って刺さる。水面と同じく、
  // 1 ピクセルに収まりきらない細かさぶんだけ滲ませておく。
  // surfaceBlur は、水面の反射としてこの球を見ている時に、その水面が
  // 捨てた細かさが入ってくる（直接見ている時は 0）
  float blur = 0.010 + surfaceBlur;

  vec3 col = mix(WIRE_BODY, skyColor(reflect(rd, q), blur), fresnel(-rd, q));

  // 線そのものが灯る。
  //
  // 鏡の反射だけに任せると、正面を向いた線は空の暗いところを返して沈み、
  // 格子が真ん中で消えてしまう。月の側ほど強く、輪郭に近いほど強く灯して、
  // 骨組みが最後まで途切れないようにする。ブルームの前の段なので、この線は滲む。
  float toward = 0.20 + 0.80 * (dot(q, uMoonDir) * 0.5 + 0.5);
  // 縁ほど強い。線が視線に対して寝ている所ほど、骨を横から見ることになる
  float limb = pow(1.0 - abs(dot(rd, q)), 1.4);
  col += MOON_TINT * toward * (0.34 + 0.66 * limb) * WIRE_GLOW * (0.75 + uLow * 0.55);

  // 線が月を返す鋭い光。月と視線のちょうど真ん中を向いた所だけが光るので、
  // 球が波打つのに合わせて光の位置が線の上を滑る
  vec3 halfway = normalize(uMoonDir - rd);
  float spec = pow(max(dot(q, halfway), 0.0), 22.0);
  // 遠い水面に映った球では、この鋭い光が 1 ピクセルに収まらない。そのまま
  // 映すと、水平線寄りで反射像が砂嵐のようにちらつく
  col += MOON_TINT * spec * WIRE_SPEC / (1.0 + surfaceBlur * 60.0);

  return col;
}

/**
 * 格子の面 1 枚ぶん。rgb が線の色、a が線の覆い（当たらなければ 0）。
 */
vec4 wireLayer(vec3 ro, vec3 rd, bool farSide, float surfaceBlur) {
  vec3 q;
  float t = sphereSurfaceHit(ro, rd, farSide, q);
  if (t < 0.0) return vec4(0.0);

  float cover = wireCoverage(rd, q, t);
  // 線の無いところが大半。空を引きに行く前にここで落とす
  if (cover < 0.004) return vec4(0.0);

  return vec4(wireColor(rd, q, surfaceBlur), cover);
}

/**
 * 球の格子。向こう側の面と手前の面を重ねたもの。
 *
 * 中は空洞なので、まず向こう側の線を薄く敷き、そのうえに手前の線を重ねる。
 * 返すのは合成済みの色と覆いで、背景へ乗せるのは呼ぶ側の仕事。
 */
vec4 sphereWire(vec3 ro, vec3 rd, float surfaceBlur) {
  // 膨らみきった大きさの球で先に外す。水面の反射からもこの判定を通すので、
  // 画面のほとんどを占める「球に当たらない視線」をここで安く落とす
  if (sphereHit(ro, rd, SPHERE_RADIUS * (1.0 + SPHERE_SWING), false) < 0.0) return vec4(0.0);

  vec4 back = wireLayer(ro, rd, true, surfaceBlur);
  back.a *= WIRE_BACK;
  vec4 front = wireLayer(ro, rd, false, surfaceBlur);

  // 奥のうえに手前を重ねる。色は覆いで重みを付けて混ぜ、最後に合計の覆いで
  // 割り戻す（このあと背景へ乗せる時にもう一度掛かるので、ここでは戻しておく）
  float alpha = front.a + back.a * (1.0 - front.a);
  if (alpha <= 0.0) return vec4(0.0);

  vec3 col = (front.rgb * front.a + back.rgb * back.a * (1.0 - front.a)) / alpha;
  return vec4(col, alpha);
}

// ---- 仕上げ ----------------------------------------------------------------
//
// ビネットとディザは、この後のブルームを重ねてからでないと意味がない。
// composite.frag が受け持つ。ここでは色を決めるところまでで手を止める。

void main() {
  // 画面中央を原点にし、縦で正規化する。横長でも縦の見え方が変わらない
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;

  // 視線。uv.y が uHorizon のところで水平になる
  vec3 rd = normalize(vec3(uv.x, uv.y - uHorizon, -1.0));
  vec3 ro = vec3(0.0, uEyeHeight, 0.0);
  vec3 col;

  // 球は線の隙間から透けるので、まず背景を最後まで決める。球を重ねるのはその後
  if (rd.y >= 0.0) {
    col = skyColor(rd, 0.0);
  } else {
    float dist = min(uEyeHeight / -rd.y, MAX_DISTANCE);
    vec3 hit = ro + rd * dist;

    float blur;
    vec3 normal = waterSurface(hit.xz, dist, blur);

    vec3 reflected = reflect(rd, normal);
    // 波が急なところでは反射が下を向く。水面下は写せないので折り返す
    reflected.y = abs(reflected.y);
    reflected = normalize(reflected);

    // 水そのものの色。手前ほど視線が立って底の暗さが出る
    vec3 body = mix(WATER_FAR, WATER_DEEP, clamp(1.0 / (1.0 + dist * 0.5), 0.0, 1.0));

    // 反射した先に球があれば、その格子が空に重なって映る。水面の一点から
    // 見上げた方向をそのまま飛ばしているので、映り込みは波に合わせて崩れ、
    // 球が動けば一緒に動く。線の隙間からは、映った空がそのまま覗く
    vec4 mirror = sphereWire(hit, reflected, blur);
    vec3 above = mix(skyColor(reflected, blur), mirror.rgb, mirror.a);

    col = mix(body, above, fresnel(-rd, normal));
  }

  // 球を背景のうえへ重ねる。丸ごと水面より上にあるので、当たったならそれは
  // 必ず水面より手前。距離を比べるまでもなく、そのまま乗せてよい
  vec4 wire = sphereWire(ro, rd, 0.0);
  col = mix(col, wire.rgb, wire.a);

  // 明るいところを圧縮する。月の芯が真っ白に潰れず、光が丸く残る
  col = col / (1.0 + col);

  fragColor = vec4(col, 1.0);
}
