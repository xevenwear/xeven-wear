import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, webcrypto } from "node:crypto";
import worker from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createInitData(userId) {
  const botToken = "test-token";
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: userId, first_name: "Test" });
  const dataCheckString = `auth_date=${authDate}\nuser=${user}`;
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString();
}

async function submitTestItem(userId) {
  const request = new Request("https://worker.example/api/orders", {
    method: "POST",
    headers: {
      origin: "https://xevenwear.github.io",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      initData: createInitData(userId),
      language: "ru",
      provider: "manual_transfer",
      items: [{ id: 999, colorIndex: 0, quantity: 1, sizes: { size: "Единый" } }],
    }),
  });
  return worker.fetch(request, {
    BOT_TOKEN: "test-token",
    TELEGRAM_OWNER_CHAT_ID: "12345",
    PUBLIC_SITE_URL: "https://xevenwear.github.io/xeven-wear/",
  });
}

test("rejects the owner-only test item for other Telegram users", async () => {
  const response = await submitTestItem(67890);
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /Тестовый товар доступен только владельцу/);
});

test("allows the configured owner past the test-item access check", async () => {
  const response = await submitTestItem(12345);
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Реквизиты для перевода/);
});
