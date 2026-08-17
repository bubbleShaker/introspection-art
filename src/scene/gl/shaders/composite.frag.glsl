#version 300 es
precision highp float;

// シーンに滲みを重ねて、画面に出すところまで持っていく。

uniform sampler2D uScene;
uniform sampler2D uBloom;
/** 滲みの強さ。中域が厚いほど光が溢れる */
uniform float uBloomStrength;

in vec2 vTexCoord;
out vec4 fragColor;

/** 暗いグラデーションに出る縞（バンディング）を、1/255 未満の揺らぎで散らす */
float dither(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 col = texture(uScene, vTexCoord).rgb;

  // 滲みは足す。掛けたり混ぜたりすると、暗い部分まで持ち上がって
  // 夜が薄い灰色になる
  col += texture(uBloom, vTexCoord).rgb * uBloomStrength;

  // 四隅を落として、視線を中央の光の道へ集める
  vec2 q = vTexCoord - 0.5;
  col *= 1.0 - dot(q, q) * 0.95;

  col += (dither(gl_FragCoord.xy) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
