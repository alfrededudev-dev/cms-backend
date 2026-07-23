// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.COMPONENT_PREVIEW_BASE || "/";
const publicUrl = (process.env.COMPONENT_PREVIEW_PUBLIC_URL || "").replace(/\/$/, "");
const isHttps = publicUrl.startsWith("https");

/** @returns {true | string[] | undefined} */
function resolveAllowedHosts() {
	const raw = process.env.COMPONENT_PREVIEW_ALLOWED_HOSTS?.trim();
	if (raw === "true" || raw === "*") {
		return true;
	}

	/** @type {Set<string>} */
	const hosts = new Set();

	if (raw) {
		for (const host of raw.split(",")) {
			const value = host.trim();
			if (value) {
				hosts.add(value);
			}
		}
	}

	if (publicUrl) {
		try {
			hosts.add(new URL(publicUrl).hostname);
		} catch {
			// ignore invalid public URL
		}
	}

	if (hosts.size === 0) {
		return undefined;
	}

	return [...hosts];
}

const allowedHosts = resolveAllowedHosts();

// Behind https://host/__component-preview:
// - `base` prefixes asset URLs (/__component-preview/@vite/client)
// - do NOT set vite.server.origin to the bare hostname — that forces /@vite/client
//   at the site root, which nginx serves as the CMS SPA (MIME text/html).
// Prefer also setting __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS / --allowed-hosts from the backend.
export default defineConfig({
	base,
	...(allowedHosts
		? {
				server: {
					allowedHosts,
				},
			}
		: {}),
	vite: {
		plugins: [tailwindcss()],
		define: {
			"import.meta.env.CMS_COMPONENT_PREVIEW": JSON.stringify(true),
		},
		server: {
			...(allowedHosts ? { allowedHosts } : {}),
			...(publicUrl
				? {
						hmr: {
							protocol: isHttps ? "wss" : "ws",
							clientPort: isHttps ? 443 : undefined,
							...(base !== "/" ? { path: base } : {}),
						},
					}
				: {}),
		},
	},
});
