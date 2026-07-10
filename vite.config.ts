import { defineConfig } from "vite";

// GitHub Pages 部署在 https://<user>.github.io/rift-pettifogger/ 下，
// 因此 base 必须与仓库名一致。前端所有对 data/*.json 的请求都用
// import.meta.env.BASE_URL 拼接，故本地 dev（base=/）与线上均可用。
export default defineConfig({
  base: process.env.PAGES_BASE ?? "/rift-pettifogger/",
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
