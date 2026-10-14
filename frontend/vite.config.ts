import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";

export default defineConfig({
  plugins: [
    react(),
    babel({
      include: /\.tsx(?:$|\?)/,
      plugins: ["@emotion/babel-plugin"],
    }),
  ],
  build: {
    outDir: "build",
  },
  server: {
    port: 3000,
  },
});
