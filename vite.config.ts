// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// When Vercel runs the build it sets `process.env.VERCEL`. There we force Nitro
// to build with the `vercel` preset so the output is the Vercel Build Output API
// (.vercel/output), which gives us the SSR server function + routing Vercel needs.
//
// Why this is required: the Lovable preset only runs Nitro's deploy plugin inside
// its own sandbox OR when an explicit `nitro` option is set here. On Vercel neither
// was true, so Nitro was skipped and the build emitted only raw dist/client +
// dist/server with no server function — which is why every route 404s. Gating on
// `process.env.VERCEL` leaves local and Lovable-sandbox builds untouched.
const vercelNitro = process.env.VERCEL
  ? {
      nitro: {
        preset: "vercel",
        // The Lovable preset otherwise forces Nitro's output into dist/. Restore the
        // exact paths the `vercel` preset expects so Vercel detects .vercel/output.
        output: {
          dir: "{{ rootDir }}/.vercel/output",
          serverDir: "{{ output.dir }}/functions/__server.func",
          publicDir: "{{ output.dir }}/static/{{ baseURL }}",
        },
      },
    }
  : {};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  ...vercelNitro,
});
