import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);

const alias = {
  "@relay": path.join(root, "src/relay"),
  "@db": path.join(root, "src/db"),
  "@auth": path.join(root, "src/auth"),
  "@client": path.join(root, "src/client"),
  "@shared": path.join(root, "src/shared"),
  "@server": path.join(root, "src/server"),
  "@": root,
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    pool: "forks",
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["src/{relay,db,shared,server,auth}/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "client",
          environment: "jsdom",
          include: ["src/client/**/*.test.{ts,tsx}", "app/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
