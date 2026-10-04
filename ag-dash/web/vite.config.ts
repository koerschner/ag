// ag-dash's page (React + the React Compiler). `bun run build` writes dist/, which the ag-dash server serves at
// /chat and which is committed, so machines need no build step. `bun run dev` serves it with hot reload and
// proxies the API to a running ag-dash (AG_DASH_API, default http://127.0.0.1:7376).
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.AG_DASH_API ?? "http://127.0.0.1:7376";
export default defineConfig({
	plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
	base: "/",
	build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets", target: "es2022" },
	server: { port: 7390, proxy: { "/api": api, "/events": api, "/static": api } },
});
