import test from "node:test";
import assert from "node:assert/strict";
import { calculateTransferAmounts } from "../src/manual-transfer.js";

test("adds the unique tail on top of the deposit and keeps the balance at half", () => {
  assert.deepEqual(calculateTransferAmounts(500000, 28), {
    depositAmount: 250000,
    transferAmount: 250028,
    remainingAmount: 250000,
    tail: 28,
  });
  assert.equal(250028 + 250000, 500000 + 28);
});

test("rounds an odd total up to the nearest whole so'm for the deposit", () => {
  assert.deepEqual(calculateTransferAmounts(500001, 41), {
    depositAmount: 250001,
    transferAmount: 250042,
    remainingAmount: 250000,
    tail: 41,
  });
});

test("keeps the 2,000 so'm test order balance at exactly 1,000", () => {
  assert.deepEqual(calculateTransferAmounts(2000, 42), {
    depositAmount: 1000,
    transferAmount: 1042,
    remainingAmount: 1000,
    tail: 42,
  });
});

test("keeps the transfer below the order total", () => {
  assert.deepEqual(calculateTransferAmounts(4, 1), {
    depositAmount: 2,
    transferAmount: 3,
    remainingAmount: 2,
    tail: 1,
  });
  assert.throws(() => calculateTransferAmounts(3, 1), /превышает сумму заказа/);
});

test("rejects invalid totals and transfer tails", () => {
  assert.throws(() => calculateTransferAmounts(1, 28), /сумма заказа/);
  assert.throws(() => calculateTransferAmounts(Number.MAX_SAFE_INTEGER + 1, 28), /сумма заказа/);
  assert.throws(() => calculateTransferAmounts(500000, 0), /код перевода/);
  assert.throws(() => calculateTransferAmounts(500000, 100), /код перевода/);
});
