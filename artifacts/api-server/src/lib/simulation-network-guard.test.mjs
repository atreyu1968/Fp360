import assert from "node:assert/strict";
import test from "node:test";
import {
  organizationsShareSimulationNetwork,
  SIMULATION_NETWORK_MISMATCH,
} from "./simulation-network-guard.mjs";

test("network boundary accepts companies in one ordinary network", () => {
  const networks = new Map([["buyer", "ordinary-a"], ["seller", "ordinary-a"]]);
  assert.equal(organizationsShareSimulationNetwork(networks, ["buyer", "seller"]), true);
});

test("network boundary accepts companies in one accelerated network", () => {
  const networks = new Map([["buyer", "accelerated-a"], ["seller", "accelerated-a"]]);
  assert.equal(organizationsShareSimulationNetwork(networks, ["buyer", "seller"]), true);
});

test("network boundary accepts repeated participant IDs in one network", () => {
  const networks = new Map([["buyer", "ordinary-a"], ["seller", "ordinary-a"]]);
  assert.equal(organizationsShareSimulationNetwork(networks, ["buyer", "seller", "seller"]), true);
});

test("network boundary rejects ordinary and accelerated companies", () => {
  const networks = new Map([["ordinary", "ordinary-a"], ["accelerated", "accelerated-a"]]);
  assert.equal(organizationsShareSimulationNetwork(networks, ["ordinary", "accelerated"]), false);
});

test("network boundary rejects different networks within the same center", () => {
  const networks = new Map([["center-company-a", "ordinary-a"], ["center-company-b", "ordinary-b"]]);
  assert.equal(organizationsShareSimulationNetwork(networks, ["center-company-a", "center-company-b"]), false);
});

test("network boundary fails closed for missing assignments and exposes a user-safe reason", () => {
  assert.equal(organizationsShareSimulationNetwork(new Map([["known", "ordinary-a"]]), ["known", "missing"]), false);
  assert.match(SIMULATION_NETWORK_MISMATCH, /misma red económica/);
});
