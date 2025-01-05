import path from "node:path";
import { defineConfig } from "vite";
import createRPCPlugin from "./vite-plugin-gen-rpc";
import solidPlugin from "vite-plugin-solid";

const basePath = new URL(".", import.meta.url).pathname;
const srcPath = path.resolve(basePath.substring(3) + "/src-frontend");

export default defineConfig({
  plugins: [
    solidPlugin(),
    createRPCPlugin({
      input: "./src-frontend/types/backend-rpc.d.ts",
      client: {
        transport: (import.meta?.env?.DEV ?? true) ? "http://localhost:4000/rspc" : "/rspc",
      },
      output: srcPath + "/logic/backend.ts",
    }),
  ],
  server: {
    port: 3000,
  },
  base: "",
  resolve: {
    alias: {
      "~": basePath + "/src-frontend",
    },
  },
});
