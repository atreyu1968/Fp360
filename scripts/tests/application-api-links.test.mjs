import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const normalize = (value) => value.replace(/\$\{[^}]+\}/g, ":id")
  .replace(/:[a-zA-Z_]\w*/g, ":id").replace(/\/$/, "") || "/";

test("all generated client operations resolve to mounted API methods, including nested routers", () => {
  const registered = new Set();
  const visited = new Set();
  function visit(filename, prefix = "") {
    const key = `${filename}|${prefix}`;
    if (visited.has(key)) return;
    visited.add(key);
    const source = readFileSync(filename, "utf8");
    const imports = new Map([...source.matchAll(/import\s+(\w+)\s+from\s+["'](\.[^"']+)["']/g)]
      .map((match) => [match[1], path.resolve(path.dirname(filename), `${match[2]}.ts`)]));
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g)) {
      registered.add(`${match[1].toUpperCase()} ${normalize(prefix + match[2])}`);
    }
    for (const match of source.matchAll(/router\.use\(\s*(?:["']([^"']+)["']\s*,\s*)?(\w+)\s*\)/g)) {
      if (imports.has(match[2])) visit(imports.get(match[2]), prefix + (match[1] ?? ""));
    }
  }
  visit(path.join(root, "artifacts/api-server/src/routes/index.ts"));
  const client = readFileSync(path.join(root, "lib/api-client-react/src/generated/api.ts"), "utf8");
  let checked = 0;
  for (const match of client.matchAll(/return `(\/api\/[^`]+)`/g)) {
    const tail = client.slice(match.index + match[0].length, match.index + match[0].length + 2500);
    const method = tail.match(/method:\s*'([A-Z]+)'/);
    assert.ok(method, `No method found for ${match[1]}`);
    const endpoint = `${method[1]} ${normalize(match[1].slice(4).split("?")[0])}`;
    assert.ok(registered.has(endpoint), `Unlinked client operation: ${endpoint}`);
    checked++;
  }
  assert.ok(checked >= 200, `Only ${checked} operations inspected; update the audit parser if codegen changes.`);
});
