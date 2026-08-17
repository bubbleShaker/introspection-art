import { defineConfig } from 'vite'

// GitHub Pages では https://bubbleshaker.github.io/introspection-art/ の下に置かれる。
// asset の URL をこのサブパス起点にしないと、公開した時だけ真っ白になる
export default defineConfig({
  base: '/introspection-art/',
  build: {
    // p5 だけで gzip 後 350kB ほどある。この絵は p5 が読めるまで何も出ないので、
    // 分割しても最初の 1 枚が早くなるわけではない。警告の線をそこに合わせる
    chunkSizeWarningLimit: 1500,
  },
})
