import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    TanStackRouterVite({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  build: {
    outDir: "dist/client",
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replace(/\\/g, "/");
          if (!path.includes("/src/") || path.includes("node_modules")) return;
          if (path.includes("/src/generators/gen-ea")) return "gen-ea-core";
          if (path.includes("/src/generators/gen-flow-ea")) return "gen-flow-ea";
          if (path.includes("/src/generators/sm-embed-registry")) return "sm-embed-registry";
          if (path.includes("/src/generators/")) return "gen-sm";
          if (path.includes("/src/lib/smc-modules/")) return "smc-detectors";
          if (path.includes("/src/lib/module-library")) return "module-library";
          if (path.includes("/src/lib/mql5-template-generator")) return "mql5-template";
        },
      },
    },
  },
});
