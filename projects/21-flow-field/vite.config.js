import { defineConfig } from "vite";

// Zwei Seiten: das Experiment (index.html) und die Scroll-Demo (scroll.html)
export default defineConfig({
  base: "./",
  build: {
    target: "esnext", // top-level await
    rollupOptions: {
      input: { main: "index.html", scroll: "scroll.html" },
    },
  },
});
