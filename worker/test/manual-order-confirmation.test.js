import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import worker from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createInitData(userId, botToken) {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: userId, first_name: "Owner" });
  const dataCheckString = `auth_date=${authDate}\nuser=${user}`;
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString();
}

test("owner deposit confirmation sends order details to owner and customer", async () => {
  const botToken = "test-token";
  const order = {
    id: "manual-order",
    status: "awaiting_transfer",
    customer_telegram_id: "12345",
    customer_username: "buyer",
    customer_first_name: "Buyer",
    language: "ru",
    total_uzs: 600000,
    deposit_uzs: 300000,
    transfer_uzs: 300047,
    tail_uzs: 47,
    remaining_uzs: 300000,
    items_json: JSON.stringify([{
      name: "Jacket",
      color: "black",
      sizes: { size: "M" },
      quantity: 1,
      unitPrice: 600000,
    }]),
  };
  const notifications = new Map();
  const sentMessages = [];
  const db = {
    prepare(sql) {
      const statement = {
        sql,
        values: [],
        bind(...values) {
          this.values = values;
          return this;
        },
        async first() {
          if (this.sql.includes("UPDATE manual_order_notifications SET claimed_at")) {
            const [, orderId, recipient] = this.values;
            const key = `${orderId}:${recipient}`;
            const notification = notifications.get(key);
            if (!notification || notification.sent_at !== null) return null;
            notification.claimed_at = this.values[0];
            return { order_id: orderId };
          }
          if (this.sql.includes("FROM manual_transfer_orders WHERE id = ?")) {
            return { ...order };
          }
          return null;
        },
        async run() {
          if (this.sql.includes("SET sent_at = ?")) {
            const [sentAt, orderId, recipient] = this.values;
            const notification = notifications.get(`${orderId}:${recipient}`);
            notification.sent_at = sentAt;
            notification.claimed_at = null;
          }
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      const [update, ...inserts] = statements;
      if (order.status !== "awaiting_transfer") return [{ meta: { changes: 0 } }];
      order.status = "partially_paid";
      order.deposit_confirmed_at = update.values[0];
      for (const insert of inserts) {
        const [recipient, createdAt, orderId] = insert.values;
        notifications.set(`${orderId}:${recipient}`, {
          created_at: createdAt,
          claimed_at: null,
          sent_at: null,
        });
      }
      return [{ meta: { changes: 1 } }, ...inserts.map(() => ({ meta: { changes: 1 } }))];
    },
  };
  const env = {
    BOT_TOKEN: botToken,
    TELEGRAM_OWNER_CHAT_ID: "999",
    DB: db,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    sentMessages.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: sentMessages.length } }));
  };

  try {
    const response = await worker.fetch(new Request("https://worker.example/api/manual-orders/admin", {
      method: "POST",
      headers: {
        origin: "https://xevenwear.github.io",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        initData: createInitData(999, botToken),
        action: "confirm_deposit",
        orderId: order.id,
      }),
    }), env);

    assert.equal(response.status, 200);
    assert.equal(order.status, "partially_paid");
    assert.equal((await response.json()).notificationsPending, false);
    assert.deepEqual(sentMessages.map((message) => message.chat_id), ["999", "12345"]);
    assert.match(sentMessages[0].text, /Buyer/);
    assert.match(sentMessages[0].text, /хвост 47 сум/);
    assert.match(sentMessages[1].text, /Предоплата получена и подтверждена/);
    assert.match(sentMessages[1].text, /300/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
