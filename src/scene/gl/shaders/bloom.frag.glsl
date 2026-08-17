#version 300 es
precision highp float;

// 明るいところだけを拾って、まとめてぼかす。
//
// これが「光が滲む」の正体。今まではその見え方を、太く薄い線と細く明るい線を
// 重ねて偽装していた。ここでは実際に明るい画素を集めて散らすので、
// 月の芯も、波の一つひとつが返す小さな光も、同じ理屈で滲む。
//
// 描き先は元絵の半分の大きさ。ぼかした結果しか使わないので粗くてよく、
// 描く面積が 1/4 で済む。

uniform sampler2D uScene;
/** ぼかす広さ。単位は「元絵（uScene）の画素」で、描き先の粗さとは無関係 */
uniform float uRadius;

in vec2 vTexCoord;
out vec4 fragColor;

/** ここから上を「光っている」とみなす */
const float THRESHOLD = 0.52;

/** 取る点の数。渦状に並べるので、少なくても方向の偏りが出にくい */
const int TAPS = 16;

/** 黄金角。連続する点の向きが最も揃いにくい刻み */
const float GOLDEN_ANGLE = 2.39996;

void main() {
  vec2 texel = 1.0 / vec2(textureSize(uScene, 0));
  vec3 sum = vec3(0.0);
  float weight = 0.0;

  for (int i = 0; i < TAPS; i++) {
    float index = float(i);
    // 中心から外へ、渦を巻きながら取る。半径を平方根で伸ばすと
    // 点が面に均等に散る（そのまま比例させると中心に固まる）
    float radius = sqrt((index + 0.5) / float(TAPS));
    float angle = index * GOLDEN_ANGLE;
    vec2 offset = vec2(cos(angle), sin(angle)) * radius * uRadius * texel;

    // 変数名に sample は使えない（GLSL ES 3.00 の予約語）
    vec3 probe = texture(uScene, vTexCoord + offset).rgb;
    // 明るいところだけを残す。閾値の下は 0、上はなだらかに立ち上げる
    float luma = dot(probe, vec3(0.2126, 0.7152, 0.0722));
    vec3 bright = probe * smoothstep(THRESHOLD, 1.0, luma);

    // 中心に近い点ほど重く見る
    float w = 1.0 - radius * 0.65;
    sum += bright * w;
    weight += w;
  }

  fragColor = vec4(sum / weight, 1.0);
}
