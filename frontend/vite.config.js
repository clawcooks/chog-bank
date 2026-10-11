import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./", // emit relative asset paths — this build is served from a
  // subpath (e.g. a published Artifact), not from the domain root.
  plugins: [react()],
  server: {
    port: 5173,
  },
});
