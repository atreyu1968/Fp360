import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applicationModules, canOpenApplication } from "../../artifacts/red-fp360/src/lib/application-modules.ts";

const app = readFileSync(new URL("../../artifacts/red-fp360/src/App.tsx", import.meta.url), "utf8");
const routes = new Set([...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]));
const rendered = new Set([...app.matchAll(/case\s+'([^']+)':/g)].map((match) => match[1]));

test("all 26 application links resolve to registered routes and rendered modules", () => {
  assert.equal(applicationModules.length, 26);
  assert.equal(new Set(applicationModules.map((module) => module.id)).size, 26);
  assert.equal(new Set(applicationModules.map((module) => module.href)).size, 26);
  for (const module of applicationModules) {
    assert.ok(routes.has(module.href), `Missing route: ${module.name} ${module.href}`);
    assert.ok(rendered.has(module.href), `Missing page: ${module.name} ${module.href}`);
  }
});

test("all static sidebar links and legacy aliases resolve to pages", () => {
  for (const match of app.matchAll(/href:\s*'([^']+)'/g)) {
    assert.ok(routes.has(match[1]), `Missing sidebar route: ${match[1]}`);
  }
  for (const alias of ["/apps", "/docs"]) {
    assert.ok(routes.has(alias));
    assert.ok(rendered.has(alias));
  }
});

test("the application catalogue enables administration only for administrators", () => {
  for (const role of ["student", "teacher", "team_manager", "mentor", "promoter"]) {
    assert.equal(applicationModules.filter((module) => canOpenApplication(module, role)).length, 25);
    assert.equal(canOpenApplication(applicationModules[25], role), false);
  }
  assert.equal(applicationModules.filter((module) => canOpenApplication(module, "administrator")).length, 26);
});
