import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Charger les variables d'environnement en fonction du mode
  const env = loadEnv(mode, process.cwd(), "");

  console.log(`🚀 Building in mode: ${mode}`);
  console.log(`💰 Payment enabled: ${env.VITE_PAYMENT_ENABLED || "default"}`);

  return {
    assetsInclude: ["**/*.glb"],
    plugins: [react()],
    server: {
      // Ignore emulator/debug logs that can trigger useless full reloads while developing
      watch: {
        ignored: [
          "**/firestore-debug.log",
          "**/firebase-debug.log",
          "**/.netlify/**",
        ],
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.js",
      globals: true,
    },
  };
});
