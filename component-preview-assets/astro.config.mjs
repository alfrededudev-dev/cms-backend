// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.COMPONENT_PREVIEW_BASE || "/";
const publicUrl = (process.env.COMPONENT_PREVIEW_PUBLIC_URL || "").replace(/\/$/, "");

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
const behindProxy = Boolean(publicUrl);

// Behind https://host/__component-preview:
// - `base` must prefix ALL vite assets (/__component-preview/@vite/client)
// - HMR is disabled remotely (WS through nginx/subpath is fragile; SSR preview is enough)
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
			// Remote CMS preview: no live reload needed; avoids wss://domain/?token= failures
			...(behindProxy ? { hmr: false } : {}),
		},
	},
});
