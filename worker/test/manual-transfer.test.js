import test from "node:test";
import assert from "node:assert/strict";
import { calculateTransferAmounts } from "../src/manual-transfer.js";

test("adds a unique tail to the 50 percent deposit and credits it toward the balance", () => {
  assert.deepEqual(calculateTransferAmounts(500000, 28), {
    depositAmount: 250000,
    transferAmount: 250028,
    remainingAmount: 249972,
    tail: 28,
  });
});

test("rounds an odd total up to the nearest whole so'm for the deposit", () => {
  assert.deepEqual(calculateTransferAmounts(500001, 41), {
    depositAmount: 250001,
    transferAmount: 250042,
    remainingAmount: 249959,
    tail: 41,
  });
});

test("keeps the transfer below the order total", () => {
  assert.deepEqual(calculateTransferAmounts(4, 1), {
    depositAmount: 2,
    transferAmount: 3,
    remainingAmount: 1,
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
