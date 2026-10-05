import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://thomasfredborg.dk",
  integrations: [sitemap()],
});
