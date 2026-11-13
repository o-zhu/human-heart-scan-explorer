import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { configureToolEnvironment } from "./scripts/tool-environment.mjs";
import { sites } from "./scripts/vite/sites-vite-plugin";
import { connectorPreview } from "./scripts/vite/connector-preview-plugin.mjs";
import { createReadStream, statSync } from "node:fs";
import { resolve, sep } from "node:path";
import ultraIndex from "./server/ultra-upload-index.json";
import fineVolumeIndex from "./server/ultra-volume-index-v7.json";

import { comparisonBanks } from "./server/donor-banks-v10.mjs";

// Development only: the managed preview reads the same verified image cache.
// Published requests are handled by the read-only R2 route in worker/index.ts.
function localScanImages() {
  return {
    name: "local-scan-image-preview",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || "/", "http://localhost").pathname;
        // These .gz files are opaque, checksummed application payloads. Vite's
        // static middleware otherwise adds HTTP gzip encoding and the browser
        // decodes them before our verified loaders can inspect the stored bytes.
        // Leave file resolution and transfer to Vite; override only known assets.
        if (["GET", "HEAD"].includes(request.method || "GET") && pathname.startsWith('/assets/') && pathname.endsWith('.gz')) {
          try {
            const directory = resolve(process.cwd(), 'public/assets');
            const filename = resolve(directory, decodeURIComponent(pathname.slice('/assets/'.length)));
            if (filename.startsWith(directory + sep) && statSync(filename).isFile()) {
              response.setHeader('Content-Type', 'application/octet-stream');
              response.setHeader('Content-Encoding', 'identity');
            }
          } catch { /* Missing or malformed assets retain Vite's normal response. */ }
        }
        const routes = [
          ...comparisonBanks.map(bank=>({prefix:bank.route,index:bank.index,directory:bank.directory,isFine:bank.kind==='volume'})),
          { prefix: '/api/ultra/v4/', index: ultraIndex, directory: 'data/ultra-sections', isFine: false },
          { prefix: '/api/ultra-volume/v7/', index: fineVolumeIndex, directory: 'data/ultra-volume-v7', isFine: true },
        ];
        const route = routes.find(item => pathname.startsWith(item.prefix));
        if (!route || !["GET", "HEAD"].includes(request.method || "GET")) return next();
        const { prefix, index, directory, isFine } = route;
        const key = pathname.slice(prefix.length);
        if (!Object.hasOwn(index, key)) return next();
        const filename = resolve(process.cwd(), directory, key);
        let size;
        try { size = statSync(filename).size; } catch { return next(); }
        if (size !== index[key].bytes) return next();
        response.setHeader("Content-Type", isFine ? "application/octet-stream" : "image/webp");
        response.setHeader("Content-Length", size);
        response.setHeader("Cache-Control", "private, max-age=3600");
        if (request.method === "HEAD") return response.end();
        createReadStream(filename).on("error", () => response.destroy()).pipe(response);
      });
    },
  };
}

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  configureToolEnvironment(process.cwd());

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      localScanImages(),
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./scripts/connector-preview/worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});
