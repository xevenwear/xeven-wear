import test from "node:test";
import assert from "node:assert/strict";
import { validateCart } from "../src/catalog.js";

test("server computes total from its catalog, not client price", () => {
  const order = validateCart([
    { id: 7, colorIndex: 1, quantity: 2, sizes: { size: "M" }, price: 1 },
  ]);
  assert.equal(order.total, 500000);
  assert.equal(order.items[0].unitPrice, 250000);
  assert.equal(order.items[0].image, "images/jeans-black.jpg");
});

test("validates every required grouped size", () => {
  assert.throws(() => validateCart([
    { id: 9, colorIndex: 0, quantity: 1, sizes: { jacketSize: "M", jeansSize: "S" } },
  ]), /набор размеров/);
});

test("rejects unknown products, invalid colors, and unsupported sizes", () => {
  assert.throws(() => validateCart([
    { id: 998, quantity: 1, sizes: { size: "M" } },
  ]), /неизвестный товар/);
  assert.throws(() => validateCart([
    { id: 7, colorIndex: 8, quantity: 1, sizes: { size: "M" } },
  ]), /цвета/);
  assert.throws(() => validateCart([
    { id: 7, colorIndex: 0, quantity: 1, sizes: { size: "ONE" } },
  ]), /размер/);
});

test("validates the owner-only test item at its server-side price", () => {
  const order = validateCart([
    { id: 999, colorIndex: 0, quantity: 1, sizes: { size: "Единый" }, price: 1 },
  ]);
  assert.equal(order.total, 1000);
  assert.equal(order.items[0].unitPrice, 1000);
  assert.equal(order.items[0].testOnly, true);
});
