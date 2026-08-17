import { defineConfig } from 'vite'

// GitHub Pages では https://bubbleshaker.github.io/introspection-art/ の下に置かれる。
// asset の URL をこのサブパス起点にしないと、公開した時だけ真っ白になる
export default defineConfig({
  base: '/introspection-art/',
})
