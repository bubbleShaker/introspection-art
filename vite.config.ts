import { defineConfig } from 'vite'

// GitHub Pages では https://bubbleshaker.github.io/introspection-art/ の下に置かれる。
// asset の URL をこのサブパス起点にしないと、公開した時だけ真っ白になる
export default defineConfig({
  base: '/introspection-art/',
  build: {
    // 音源はビルド時に触らずそのまま public/ から配られる。
    // 圧縮済みの mp3 をインライン化されると困るので念のため 0 にしておく
    assetsInlineLimit: 0,
  },
})
