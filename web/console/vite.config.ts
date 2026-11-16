import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The admin console (M9), served by the admin API's own process (ucp.admin.app) from web/console/dist.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
  },
});
