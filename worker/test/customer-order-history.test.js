import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import worker from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createInitData(userId, botToken) {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: userId, first_name: "Customer" });
  const dataCheckString = `auth_date=${authDate}\nuser=${user}`;
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString();
}

test("returns only the authenticated customer's combined order history", async () => {
  const botToken = "test-token";
  const queriedIds = [];
  const env = {
    BOT_TOKEN: botToken,
    MANUAL_TRANSFER_BANK: "Test bank",
    MANUAL_TRANSFER_CARDHOLDER: "Shop owner",
    MANUAL_TRANSFER_CARD_NUMBER: "0000 0000 0000 0000",
    DB: {
      prepare(sql) {
        return {
          bind(customerId) {
            queriedIds.push(customerId);
            return {
              async all() {
                if (sql.includes("manual_transfer_orders")) {
                  return {
                    results: [{
                      id: "manual-order",
                      created_at: 200,
                      status: "awaiting_transfer",
                      total_uzs: 500000,
                      deposit_uzs: 250000,
                      transfer_uzs: 250028,
                      tail_uzs: 28,
                      remaining_uzs: 250000,
                      items_json: JSON.stringify([{ name: "Jeans", quantity: 2 }]),
                    }],
                  };
                }
                return {
                  results: [{
                    id: "online-order",
                    created_at: 100,
                    status: "paid",
                    payment_provider: "payme",
                    total_uzs: 100000,
                    items_json: JSON.stringify([{ name: "Shoes", quantity: 1 }]),
                  }],
                };
              },
            };
          },
        };
      },
    },
  };
  const response = await worker.fetch(new Request("https://worker.example/api/orders/history", {
    method: "POST",
    headers: {
      origin: "https://xevenwear.github.io",
      "content-type": "application/json",
    },
    body: JSON.stringify({ initData: createInitData(12345, botToken) }),
  }), env);

  assert.equal(response.status, 200);
  assert.deepEqual(queriedIds, ["12345", "12345"]);
  const { orders } = await response.json();
  assert.deepEqual(orders.map((order) => order.id), ["manual-order", "online-order"]);
  assert.equal(orders[0].remaining_uzs, 250000);
  assert.equal(orders[0].payment_provider, "manual_transfer");
  assert.deepEqual(orders[0].payment_details, {
    bank: "Test bank",
    cardholder: "Shop owner",
    cardNumber: "0000 0000 0000 0000",
  });
  assert.equal(orders[1].payment_details, null);
  assert.equal("customer_telegram_id" in orders[0], false);
});
