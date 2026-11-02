import { build } from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";

const dependencies = Object.keys(JSON.parse(readFileSync(
  new URL("../package.json", import.meta.url), "utf8",
)).dependencies).filter(name => !name.startsWith("@workspace/"));

await build({
  entryPoints: [new URL("./recovery-access.ts", import.meta.url).pathname],
  outfile: process.argv[2],
  bundle: true,
  platform: "node",
  format: "esm",
  // Bundle shared-library dependencies (notably Zod) that are not direct
  // dependencies of the API package; retain its normal runtime dependencies.
  external: [...dependencies, "pg"],
  plugins: [{
    name: "bundle-workspace-only",
    setup(build) {
      for (const [name, file] of [
        ["@workspace/db", "lib/db/src/index.ts"],
        ["@workspace/api-zod", "lib/api-zod/src/index.ts"],
      ]) {
        build.onResolve({ filter: new RegExp(`^${name}$`) }, () => ({ path: path.resolve(file) }));
      }
    },
  }],
});
