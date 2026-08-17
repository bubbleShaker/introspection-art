#version 300 es

// 全面に張った板を、そのまま画面へ置くだけ。絵の中身は全部 fragment 側にある。
//
// p5 が版を足してくれるのは組み込みのシェーダーだけで、createShader に渡した
// ものには手が入らない。だから `#version` は自分で、しかも 1 行目に書く
// （前に何か置くとコンパイルが通らない）。GLSL ES 3.00 なので attribute /
// varying ではなく in / out を使う。

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

in vec3 aPosition;

void main() {
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
