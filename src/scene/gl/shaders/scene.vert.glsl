#version 300 es

// 全面に張った板を、そのまま画面へ置くだけ。絵の中身は全部 fragment 側にある。
// 三本のシェーダー（シーン・ブルーム・合成）で共用する。
//
// p5 が版を足してくれるのは組み込みのシェーダーだけで、createShader に渡した
// ものには手が入らない。だから `#version` は自分で、しかも 1 行目に書く
// （前に何か置くとコンパイルが通らない）。GLSL ES 3.00 なので attribute /
// varying ではなく in / out を使う。

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;

in vec3 aPosition;
in vec2 aTexCoord;

out vec2 vTexCoord;

void main() {
  // 上下を返しておく。p5 が板に載せる texCoord は「上が 0」（画像を貼ると
  // 正しい向きになる並び）だが、フレームバッファをテクスチャとして読むと
  // 「下が 0」で入っている。ここで一度揃えておくと、テクスチャを読む側は
  // どれも素直に vTexCoord をそのまま使える。
  vTexCoord = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
  gl_Position = uProjectionMatrix * uModelViewMatrix * vec4(aPosition, 1.0);
}
