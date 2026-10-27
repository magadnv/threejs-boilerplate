import { defineConfig } from "vite";

// Zwei Seiten: index.html (Experiment) und scroll.html (Scroll-Story-Beispiel)
export default defineConfig({
  build: {
    target: "esnext", // Top-Level-await in main.js
    rollupOptions: {
      input: { main: "index.html", scroll: "scroll.html" },
    },
  },
});
