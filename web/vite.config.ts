import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const VERSION = readFileSync(resolve(webDir, "../VERSION"), "utf-8").trim() || "dev";
const CHANGELOG = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf-8");

export default defineConfig({
    plugins: [react()],
    resolve: { alias: { "@": resolve(webDir, "src") } },
    define: {
        __APP_VERSION__: JSON.stringify(VERSION),
        __APP_RELEASES__: JSON.stringify(parseChangelog(CHANGELOG)),
    },
    server: {
        port: 3000,
        proxy: {
            "/api": {
                target: process.env.API_BASE_URL || "http://127.0.0.1:8088",
                changeOrigin: true,
            },
        },
    },
});
