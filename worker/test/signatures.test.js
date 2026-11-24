import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, webcrypto } from "node:crypto";
import { clickSignatureMatches, verifyTelegramInitData } from "../src/index.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

test("validates Telegram initData and rejects a tampered user", async () => {
  const botToken = "test-token";
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: 12345, first_name: "Customer", username: "customer" });
  const dataCheckString = `auth_date=${authDate}\nuser=${user}`;
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  const initData = new URLSearchParams({ auth_date: authDate, user, hash }).toString();

  assert.deepEqual(await verifyTelegramInitData(initData, botToken), {
    id: "12345",
    username: "customer",
    firstName: "Customer",
  });
  await assert.rejects(
    verifyTelegramInitData(initData.replace("customer", "attacker"), botToken),
    /проверить Telegram/,
  );
});

test("validates the Click callback signature", () => {
  const env = { CLICK_SECRET_KEY: "test-secret" };
  const form = {
    click_trans_id: "1001",
    service_id: "2002",
    merchant_trans_id: "order-id",
    amount: "250000.00",
    action: "0",
    sign_time: "2025-01-01 10:00:00",
  };
  form.sign_string = createHash("md5")
    .update(`${form.click_trans_id}${form.service_id}${env.CLICK_SECRET_KEY}${form.merchant_trans_id}${form.amount}${form.action}${form.sign_time}`)
    .digest("hex");

  assert.equal(clickSignatureMatches(form, env), true);
  assert.equal(clickSignatureMatches({ ...form, amount: "1" }, env), false);
});
