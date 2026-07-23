// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.COMPONENT_PREVIEW_BASE || "/";
const publicUrl = (process.env.COMPONENT_PREVIEW_PUBLIC_URL || "").replace(/\/$/, "");
const isHttps = publicUrl.startsWith("https");

// Behind https://host/__component-preview:
// - `base` prefixes asset URLs (/__component-preview/@vite/client)
// - do NOT set vite.server.origin to the bare hostname — that forces /@vite/client
//   at the site root, which nginx serves as the CMS SPA (MIME text/html).
export default defineConfig({
	base,
	vite: {
		plugins: [tailwindcss()],
		define: {
			"import.meta.env.CMS_COMPONENT_PREVIEW": JSON.stringify(true),
		},
		...(publicUrl
			? {
					server: {
						hmr: {
							protocol: isHttps ? "wss" : "ws",
							clientPort: isHttps ? 443 : undefined,
							...(base !== "/" ? { path: base } : {}),
						},
					},
				}
			: {}),
	},
});
