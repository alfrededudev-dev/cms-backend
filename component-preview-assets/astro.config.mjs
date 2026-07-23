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

/** @returns {{ host: string, clientPort: number } | null} */
function resolvePublicHost() {
	if (!publicUrl) {
		return null;
	}

	try {
		const url = new URL(publicUrl);
		const clientPort = url.port
			? Number(url.port)
			: url.protocol === "https:"
				? 443
				: 80;
		return { host: url.hostname, clientPort };
	} catch {
		return null;
	}
}

const allowedHosts = resolveAllowedHosts();
const publicHost = resolvePublicHost();
const hmrPath = base !== "/" ? base.replace(/\/$/, "") || "/" : undefined;

// Behind https://host/__component-preview:
// - `base` prefixes asset URLs
// - HMR must use the public host + path (not wss://host/ or wss://localhost:port)
// - do NOT set vite.server.origin to the bare hostname
export default defineConfig({
	base,
	devToolbar: {
		enabled: false,
	},
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
			...(publicHost
				? {
						hmr: {
							protocol: isHttps ? "wss" : "ws",
							host: publicHost.host,
							clientPort: publicHost.clientPort,
							...(hmrPath ? { path: hmrPath } : {}),
						},
					}
				: {}),
		},
	},
});
