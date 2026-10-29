import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://territory.paddaone.com",
  output: "static",
  // Pages volontairement en noindex : hors sitemap (pas de Disallow, Google doit lire le noindex)
  integrations: [
    sitemap({
      filter: (page) => {
        const path = new URL(page).pathname;
        return path !== "/tool/" && path !== "/mentions-legales/";
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
