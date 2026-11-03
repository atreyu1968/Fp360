import assert from "node:assert/strict";
import test from "node:test";
import { purchaseInstructionStatus } from "./purchase-instruction-status.mjs";

test("supplier payment instruction stages stay distinct from bank payment states", () => {
  assert.equal(purchaseInstructionStatus("draft"), "pending_review");
  assert.equal(purchaseInstructionStatus("pending_review"), "pending_review");
  assert.equal(purchaseInstructionStatus("authorized"), "authorized");
  assert.equal(purchaseInstructionStatus("scheduled"), "authorized");
  assert.equal(purchaseInstructionStatus("executed"), "executed");
  assert.equal(purchaseInstructionStatus("rejected"), "rejected");
  assert.equal(purchaseInstructionStatus("cancelled"), null);
});

test("unknown supplier instruction stages fail explicitly", () => {
  assert.throws(() => purchaseInstructionStatus("paid"), /Unsupported supplier payment instruction status/);
});
