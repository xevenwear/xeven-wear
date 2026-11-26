import { createHash } from "node:crypto";
import { validateCart } from "./catalog.js";
import { calculateTransferAmounts } from "./manual-transfer.js";

const DEFAULT_ORIGIN = "https://xevenwear.github.io";
const TELEGRAM_API = "https://api.telegram.org";
const PAYME_TTL_MS = 12 * 60 * 60 * 1000;
const MANUAL_TRANSFER_WINDOW_MS = 30 * 60 * 1000;
const sizeLabels = {
  ru: {
    size: "размер",
    jacketSize: "куртка",
    hoodieSize: "худи",
    jeansSize: "джинсы",
    upperSize: "верх",
    pantsSize: "брюки",
    sneakersSize: "кроссовки",
  },
  uz: {
    size: "o‘lcham",
    jacketSize: "kurtka",
    hoodieSize: "xudi",
    jeansSize: "jinsilar",
    upperSize: "ustki kiyim",
    pantsSize: "shim",
    sneakersSize: "krossovka",
  },
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function corsHeaders(origin, env) {
  const allowedOrigin = env.APP_ORIGIN || DEFAULT_ORIGIN;
  if (origin && origin !== allowedOrigin) return null;
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function equalConstantTime(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmacSha256(key, message) {
  const keyBytes = new TextEncoder().encode(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message)));
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyTelegramInitData(initData, botToken) {
  if (typeof initData !== "string" || initData.length === 0 || initData.length > 8192) {
    throw new Error("Откройте магазин из Telegram.");
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || params.getAll("hash").length !== 1) throw new Error("Не удалось проверить Telegram.");

  const pairs = [];
  for (const [key, value] of params) {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const secretKey = await hmacSha256("WebAppData", botToken);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    secretKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = toHex(new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(pairs.join("\n"))),
  ));
  if (!equalConstantTime(expected, hash.toLowerCase())) throw new Error("Не удалось проверить Telegram.");

  const authDate = Number(params.get("auth_date"));
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(authDate) || authDate > now + 60 || now - authDate > 86400) {
    throw new Error("Сеанс Telegram устарел. Перезапустите магазин.");
  }
  let user;
  try {
    user = JSON.parse(params.get("user") || "");
  } catch {
    throw new Error("Не удалось получить профиль Telegram.");
  }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("Не удалось получить профиль Telegram.");
  }
  return {
    id: String(user.id),
    username: typeof user.username === "string" ? user.username.slice(0, 64) : null,
    firstName: typeof user.first_name === "string" ? user.first_name.slice(0, 128) : "",
  };
}

function requiredEnv(env, names) {
  return names.every((name) => typeof env[name] === "string" && env[name].length > 0);
}

function publicImageUrl(path, env) {
  const base = (env.PUBLIC_SITE_URL || `${DEFAULT_ORIGIN}/xeven-wear`).replace(/\/+$/, "");
  return `${base}/${path}`;
}

function buildPaymeUrl(order, env) {
  const returnUrl = env.PUBLIC_SITE_URL || `${DEFAULT_ORIGIN}/xeven-wear/`;
  const payload = `m=${env.PAYME_MERCHANT_ID};ac.order_id=${order.id};a=${order.total_uzs * 100};c=${returnUrl}`;
  const encoded = btoa(payload);
  return `https://checkout.paycom.uz/${encoded}`;
}

function buildClickUrl(order, env) {
  const params = new URLSearchParams({
    service_id: env.CLICK_SERVICE_ID,
    merchant_id: env.CLICK_MERCHANT_ID,
    amount: String(order.total_uzs),
    transaction_param: order.id,
    return_url: env.PUBLIC_SITE_URL || `${DEFAULT_ORIGIN}/xeven-wear/`,
  });
  return `https://my.click.uz/services/pay?${params}`;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatSizes(sizes, language) {
  const labels = sizeLabels[language] || sizeLabels.ru;
  return Object.entries(sizes)
    .map(([key, size]) => `${labels[key] || key}: ${size}`)
    .join(", ");
}

async function telegramCall(env, method, payload) {
  const response = await fetch(`${TELEGRAM_API}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Telegram API returned HTTP ${response.status}.`);
  const result = await response.json();
  if (!result.ok) throw new Error(`Telegram API rejected ${method}.`);
  return result.result;
}

function orderText(order, items) {
  const username = order.customer_username
    ? `@${htmlEscape(order.customer_username)}`
    : "не указан";
  const firstName = order.customer_first_name
    ? htmlEscape(order.customer_first_name)
    : "не указано";
  const rows = items.map((item, index) => {
    const sizeText = htmlEscape(formatSizes(item.sizes, order.language));
    return `${index + 1}. <b>${htmlEscape(item.name)}</b> — ${htmlEscape(item.color)}; ${sizeText}; ${item.quantity} шт. × ${item.unitPrice.toLocaleString("ru-RU")} сум`;
  });
  return [
    `<b>Оплачен заказ XEVEN WEAR</b>`,
    `Заказ: <code>${htmlEscape(order.id)}</code>`,
    `Покупатель: ${firstName} (${username})`,
    `Telegram ID: <code>${htmlEscape(order.customer_telegram_id)}</code>`,
    "",
    ...rows,
    "",
    `<b>Оплачено: ${order.total_uzs.toLocaleString("ru-RU")} сум</b>`,
    `Оплата: ${htmlEscape(order.payment_provider.toUpperCase())}`,
  ].join("\n");
}

function manualOrderText(order, items) {
  const username = order.customer_username
    ? `@${htmlEscape(order.customer_username)}`
    : "не указан";
  const firstName = order.customer_first_name
    ? htmlEscape(order.customer_first_name)
    : "не указано";
  const rows = items.map((item, index) => {
    const sizeText = htmlEscape(formatSizes(item.sizes, order.language));
    return `${index + 1}. <b>${htmlEscape(item.name)}</b> — ${htmlEscape(item.color)}; ${sizeText}; ${item.quantity} шт. × ${item.unitPrice.toLocaleString("ru-RU")} сум`;
  });
  return [
    `<b>Новый заказ XEVEN WEAR — ожидает предоплату</b>`,
    `Заказ: <code>${htmlEscape(order.id)}</code>`,
    `Покупатель: ${firstName} (${username})`,
    `Telegram ID: <code>${htmlEscape(order.customer_telegram_id)}</code>`,
    "",
    ...rows,
    "",
    `Сумма заказа: ${order.total_uzs.toLocaleString("ru-RU")} сум`,
    `<b>К переводу сейчас: ${order.transfer_uzs.toLocaleString("ru-RU")} сум</b>`,
    `Предоплата: ${order.deposit_uzs.toLocaleString("ru-RU")} сум + хвост ${order.tail_uzs} сум (сверху, не засчитывается в остаток)`,
    `Остаток ко второй оплате: ${order.remaining_uzs.toLocaleString("ru-RU")} сум`,
  ].join("\n");
}

async function sendOrderPhotos(env, items, language) {
  const mediaItems = items.map((item) => ({
    image: publicImageUrl(item.image, env),
    caption: `<b>${htmlEscape(item.name)}</b>\n${htmlEscape(item.color)} · ${htmlEscape(formatSizes(item.sizes, language))}\n${item.quantity} шт.`,
  }));
  for (let index = 0; index < mediaItems.length; index += 10) {
    const group = mediaItems.slice(index, index + 10);
    if (group.length === 1) {
      await telegramCall(env, "sendPhoto", {
        chat_id: env.TELEGRAM_OWNER_CHAT_ID,
        photo: group[0].image,
        caption: group[0].caption,
        parse_mode: "HTML",
      });
    } else {
      await telegramCall(env, "sendMediaGroup", {
        chat_id: env.TELEGRAM_OWNER_CHAT_ID,
        media: group.map(({ image, caption }) => ({
          type: "photo",
          media: image,
          caption,
          parse_mode: "HTML",
        })),
      });
    }
  }
}

async function sendOrderNotification(env, orderId) {
  const now = Date.now();
  const claim = await env.DB.prepare(
    `UPDATE orders
     SET notification_claimed_at = ?
     WHERE id = ? AND status = 'paid' AND notification_sent_at IS NULL
       AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
     RETURNING id, customer_telegram_id, customer_username, customer_first_name,
       payment_provider, total_uzs, items_json, language`,
  ).bind(now, orderId, now - 120000).first();
  if (!claim) return;

  try {
    const items = safeParseJson(claim.items_json);
    if (!Array.isArray(items)) throw new Error("Stored order items are invalid.");

    const customerLink = claim.customer_username
      ? `https://t.me/${encodeURIComponent(claim.customer_username)}`
      : `tg://user?id=${encodeURIComponent(claim.customer_telegram_id)}`;
    await telegramCall(env, "sendMessage", {
      chat_id: env.TELEGRAM_OWNER_CHAT_ID,
      text: orderText(claim, items),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Связаться с покупателем", url: customerLink }]],
      },
    });

    await sendOrderPhotos(env, items, claim.language);
    await env.DB.prepare(
      "UPDATE orders SET notification_sent_at = ?, notification_claimed_at = NULL, notification_error = NULL WHERE id = ?",
    ).bind(Date.now(), orderId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE orders SET notification_claimed_at = NULL, notification_error = ? WHERE id = ?",
    ).bind(String(error?.message || "Telegram notification failed").slice(0, 250), orderId).run();
    console.error("Order notification failed", orderId, error);
  }
}

async function sendManualTransferNotification(env, orderId) {
  const now = Date.now();
  const claim = await env.DB.prepare(
    `UPDATE manual_transfer_orders
     SET notification_claimed_at = ?
     WHERE id = ? AND notification_sent_at IS NULL
       AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
     RETURNING id, customer_telegram_id, customer_username, customer_first_name,
       language, total_uzs, deposit_uzs, transfer_uzs, tail_uzs, remaining_uzs, items_json`,
  ).bind(now, orderId, now - 120000).first();
  if (!claim) return;

  try {
    const items = safeParseJson(claim.items_json);
    if (!Array.isArray(items)) throw new Error("Stored manual order items are invalid.");

    const customerLink = claim.customer_username
      ? `https://t.me/${encodeURIComponent(claim.customer_username)}`
      : `tg://user?id=${encodeURIComponent(claim.customer_telegram_id)}`;
    await telegramCall(env, "sendMessage", {
      chat_id: env.TELEGRAM_OWNER_CHAT_ID,
      text: manualOrderText(claim, items),
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Связаться с покупателем", url: customerLink }]],
      },
    });
    await sendOrderPhotos(env, items, claim.language);
    await env.DB.prepare(
      "UPDATE manual_transfer_orders SET notification_sent_at = ?, notification_claimed_at = NULL, notification_error = NULL WHERE id = ?",
    ).bind(Date.now(), orderId).run();
  } catch (error) {
    await env.DB.prepare(
      "UPDATE manual_transfer_orders SET notification_claimed_at = NULL, notification_error = ? WHERE id = ?",
    ).bind(String(error?.message || "Telegram notification failed").slice(0, 250), orderId).run();
    console.error("Manual order notification failed", orderId, error);
  }
}

function randomTransferTail(maxTail = 99) {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return 1 + (value[0] % maxTail);
}

async function createManualTransferOrder(env, cors, body, customer, validated) {
  if (!requiredEnv(env, [
    "MANUAL_TRANSFER_BANK",
    "MANUAL_TRANSFER_CARDHOLDER",
    "MANUAL_TRANSFER_CARD_NUMBER",
  ])) {
    return json({ error: "Реквизиты для перевода ещё не настроены." }, 503, cors);
  }

  const depositBase = Math.ceil(validated.total / 2);
  const maxTail = Math.min(99, validated.total - depositBase - 1);
  if (maxTail < 1) {
    return json({ error: "Сумма заказа слишком мала для уникального хвоста перевода." }, 400, cors);
  }
  for (let attempt = 0; attempt < 99; attempt += 1) {
    const amounts = calculateTransferAmounts(validated.total, randomTransferTail(maxTail));
    const orderId = crypto.randomUUID();
    const createdAt = Date.now();
    const result = await env.DB.prepare(
      `INSERT INTO manual_transfer_orders (
         id, created_at, status, customer_telegram_id, customer_username,
         customer_first_name, language, total_uzs, deposit_uzs, transfer_uzs,
         tail_uzs, remaining_uzs, items_json
       ) VALUES (?, ?, 'awaiting_transfer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(transfer_uzs) DO NOTHING`,
    ).bind(
      orderId,
      createdAt,
      customer.id,
      customer.username,
      customer.firstName,
      body.language,
      validated.total,
      depositBase,
      amounts.transferAmount,
      amounts.tail,
      amounts.remainingAmount,
      JSON.stringify(validated.items),
    ).run();

    if (result.meta?.changes !== 1) continue;

    await sendManualTransferNotification(env, orderId);
    return json({
      orderId,
      paymentMethod: "manual_transfer",
      totalAmount: validated.total,
      depositAmount: depositBase,
      tail: amounts.tail,
      transferAmount: amounts.transferAmount,
      remainingAmount: amounts.remainingAmount,
      bank: env.MANUAL_TRANSFER_BANK,
      cardholder: env.MANUAL_TRANSFER_CARDHOLDER,
      cardNumber: env.MANUAL_TRANSFER_CARD_NUMBER,
    }, 201, cors);
  }

  return json({ error: "Не удалось подобрать свободный хвост суммы. Попробуйте позже." }, 503, cors);
}

async function createOrder(request, env, cors) {
  if (!requiredEnv(env, ["BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID", "PUBLIC_SITE_URL"])) {
    return json({ error: "Сервер магазина ещё не настроен." }, 503, cors);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }
  if (!["ru", "uz"].includes(body.language)) {
    return json({ error: "Неизвестный язык заказа." }, 400, cors);
  }
  const provider = body.provider;
  if (provider === "manual_transfer") {
    let customer;
    let validated;
    try {
      customer = await verifyTelegramInitData(body.initData, env.BOT_TOKEN);
      validated = validateCart(body.items, body.language);
    } catch (error) {
      return json({ error: error.message }, 400, cors);
    }
    if (validated.items.some((item) => item.testOnly) &&
        customer.id !== String(env.TELEGRAM_OWNER_CHAT_ID)) {
      return json({ error: "Тестовый товар доступен только владельцу магазина." }, 403, cors);
    }
    return createManualTransferOrder(env, cors, body, customer, validated);
  }

  const providerEnv = provider === "payme"
    ? ["PAYME_MERCHANT_ID", "PAYME_KEY"]
    : provider === "click"
      ? ["CLICK_MERCHANT_ID", "CLICK_SERVICE_ID", "CLICK_SECRET_KEY"]
      : null;
  if (!providerEnv) return json({ error: "Выберите Payme или Click." }, 400, cors);
  if (!requiredEnv(env, providerEnv)) {
    return json({ error: `Платёжный сервис ${provider} ещё не настроен.` }, 503, cors);
  }

  let customer;
  let validated;
  try {
    customer = await verifyTelegramInitData(body.initData, env.BOT_TOKEN);
    validated = validateCart(body.items, body.language);
  } catch (error) {
    return json({ error: error.message }, 400, cors);
  }
  if (validated.items.some((item) => item.testOnly) &&
      customer.id !== String(env.TELEGRAM_OWNER_CHAT_ID)) {
    return json({ error: "Тестовый товар доступен только владельцу магазина." }, 403, cors);
  }

  const orderId = crypto.randomUUID();
  const createdAt = Date.now();
  const paymentUrl = provider === "payme"
    ? buildPaymeUrl({ id: orderId, total_uzs: validated.total }, env)
    : buildClickUrl({ id: orderId, total_uzs: validated.total }, env);
  await env.DB.prepare(
    `INSERT INTO orders (
       id, created_at, status, customer_telegram_id, customer_username,
       customer_first_name, language, payment_provider, total_uzs, items_json
     ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    orderId,
    createdAt,
    customer.id,
    customer.username,
    customer.firstName,
    body.language,
    provider,
    validated.total,
    JSON.stringify(validated.items),
  ).run();

  return json({ orderId, paymentUrl }, 201, cors);
}

function paymeError(id, code, message, data) {
  const error = {
    code,
    message: { ru: message, uz: message },
  };
  if (data) error.data = data;
  return json({ error, id: id ?? null });
}

function paymeResult(id, result) {
  return json({ result, id: id ?? null });
}

async function getPaymeOrder(env, params) {
  const orderId = params?.account?.order_id;
  if (typeof orderId !== "string" || orderId.length > 64) return null;
  return env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(orderId).first();
}

async function notifyIfPaid(env, orderId) {
  await sendOrderNotification(env, orderId);
}

async function handlePaymeMethod(method, params, env, requestId) {
  const now = Date.now();
  if (method === "CheckPerformTransaction") {
    const order = await getPaymeOrder(env, params);
    if (!order) return paymeError(requestId, -31050, "Заказ не найден.", "order_id");
    if (order.payment_provider !== "payme" || order.status !== "pending") {
      return paymeError(requestId, -31050, "Заказ нельзя оплатить.", "order_id");
    }
    if (params.amount !== order.total_uzs * 100) {
      return paymeError(requestId, -31001, "Сумма заказа не совпадает.", "amount");
    }
    return paymeResult(requestId, { allow: true });
  }

  if (method === "CreateTransaction") {
    const order = await getPaymeOrder(env, params);
    const transactionId = params?.id;
    const amount = params?.amount;
    const paymeTime = params?.time;
    if (!order) return paymeError(requestId, -31050, "Заказ не найден.", "order_id");
    if (order.payment_provider !== "payme") {
      return paymeError(requestId, -31050, "Заказ нельзя оплатить.", "order_id");
    }
    if (!Number.isSafeInteger(amount) || amount !== order.total_uzs * 100) {
      return paymeError(requestId, -31001, "Сумма заказа не совпадает.", "amount");
    }
    if (typeof transactionId !== "string" || transactionId.length === 0 || transactionId.length > 128 ||
        !Number.isSafeInteger(paymeTime)) {
      return paymeError(requestId, -32602, "Некорректные параметры транзакции.");
    }
    if (now - paymeTime > PAYME_TTL_MS || paymeTime > now + 60000) {
      return paymeError(requestId, -31008, "Время создания транзакции истекло.");
    }
    const existing = await env.DB.prepare(
      "SELECT * FROM payme_transactions WHERE id = ?",
    ).bind(transactionId).first();
    if (existing) {
      if (existing.order_id !== order.id || existing.amount !== amount) {
        return paymeError(requestId, -31050, "Идентификатор транзакции уже использован.");
      }
      return paymeResult(requestId, {
        transaction: existing.id,
        state: existing.state,
        create_time: existing.create_time,
        perform_time: existing.perform_time || 0,
        cancel_time: existing.cancel_time || 0,
      });
    }
    if (order.status !== "pending") {
      return paymeError(requestId, -31050, "Заказ нельзя оплатить.", "order_id");
    }
    const active = await env.DB.prepare(
      "SELECT id, create_time FROM payme_transactions WHERE order_id = ? AND state = 1",
    ).bind(order.id).first();
    if (active && now - active.create_time <= PAYME_TTL_MS) {
      return paymeError(requestId, -31008, "Для заказа уже создана транзакция.");
    }
    if (active) {
      await env.DB.prepare(
        "UPDATE payme_transactions SET state = -1, cancel_time = ?, reason = 4 WHERE id = ? AND state = 1",
      ).bind(now, active.id).run();
    }
    await env.DB.prepare(
      `INSERT INTO payme_transactions (id, order_id, state, amount, create_time, perform_time, cancel_time, reason)
       VALUES (?, ?, 1, ?, ?, 0, 0, NULL)`,
    ).bind(transactionId, order.id, amount, paymeTime).run();
    return paymeResult(requestId, {
      transaction: transactionId,
      state: 1,
      create_time: paymeTime,
      perform_time: 0,
      cancel_time: 0,
    });
  }

  if (method === "PerformTransaction") {
    const transaction = await env.DB.prepare(
      "SELECT * FROM payme_transactions WHERE id = ?",
    ).bind(params?.id).first();
    if (!transaction) return paymeError(requestId, -31003, "Транзакция не найдена.");
    if (transaction.state === 2) {
      await notifyIfPaid(env, transaction.order_id);
      return paymeResult(requestId, {
        transaction: transaction.id,
        perform_time: transaction.perform_time,
        state: 2,
      });
    }
    if (transaction.state !== 1) return paymeError(requestId, -31008, "Транзакция отменена.");
    if (now - transaction.create_time > PAYME_TTL_MS) {
      return paymeError(requestId, -31008, "Время оплаты заказа истекло.");
    }
    const order = await env.DB.prepare(
      "SELECT status, payment_provider FROM orders WHERE id = ?",
    ).bind(transaction.order_id).first();
    if (!order || order.payment_provider !== "payme" || !["pending", "paid"].includes(order.status)) {
      return paymeError(requestId, -31050, "Заказ нельзя оплатить.");
    }
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE payme_transactions SET state = 2, perform_time = ?
         WHERE id = ? AND state = 1 AND EXISTS (
           SELECT 1 FROM orders
           WHERE orders.id = payme_transactions.order_id AND orders.payment_provider = 'payme'
             AND orders.status IN ('pending', 'paid')
         )`,
      ).bind(now, transaction.id),
      env.DB.prepare(
        `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?)
         WHERE id = ? AND payment_provider = 'payme' AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM payme_transactions
             WHERE payme_transactions.id = ? AND payme_transactions.order_id = orders.id
               AND payme_transactions.state = 2
           )`,
      ).bind(now, transaction.order_id, transaction.id),
    ]);
    const completed = await env.DB.prepare(
      `SELECT payme_transactions.state, payme_transactions.perform_time, orders.status
       FROM payme_transactions JOIN orders ON orders.id = payme_transactions.order_id
       WHERE payme_transactions.id = ?`,
    ).bind(transaction.id).first();
    if (completed?.state !== 2 || completed.status !== "paid") {
      return paymeError(requestId, -31008, "Невозможно завершить транзакцию.");
    }
    await notifyIfPaid(env, transaction.order_id);
    return paymeResult(requestId, {
      transaction: transaction.id,
      perform_time: completed.perform_time,
      state: 2,
    });
  }

  if (method === "CancelTransaction") {
    const transaction = await env.DB.prepare(
      "SELECT * FROM payme_transactions WHERE id = ?",
    ).bind(params?.id).first();
    if (!transaction) return paymeError(requestId, -31003, "Транзакция не найдена.");
    if (transaction.state === -1 || transaction.state === -2) {
      return paymeResult(requestId, {
        transaction: transaction.id,
        cancel_time: transaction.cancel_time,
        state: transaction.state,
      });
    }
    const state = transaction.state === 2 ? -2 : -1;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE payme_transactions SET state = ?, cancel_time = ?, reason = ? WHERE id = ? AND state = ?",
      ).bind(state, now, params?.reason ?? null, transaction.id, transaction.state),
      env.DB.prepare(
        `UPDATE orders SET status = ?
         WHERE id = ? AND status = ? AND EXISTS (
           SELECT 1 FROM payme_transactions
           WHERE payme_transactions.id = ? AND payme_transactions.order_id = orders.id
             AND payme_transactions.state = ?
         )`,
      ).bind(state === -1 ? "cancelled" : "refunded", transaction.order_id,
        state === -1 ? "pending" : "paid", transaction.id, state),
    ]);
    const cancelled = await env.DB.prepare(
      "SELECT state, cancel_time FROM payme_transactions WHERE id = ?",
    ).bind(transaction.id).first();
    return paymeResult(requestId, {
      transaction: transaction.id,
      cancel_time: cancelled.cancel_time,
      state: cancelled.state,
    });
  }

  if (method === "CheckTransaction") {
    const transaction = await env.DB.prepare(
      "SELECT * FROM payme_transactions WHERE id = ?",
    ).bind(params?.id).first();
    if (!transaction) return paymeError(requestId, -31003, "Транзакция не найдена.");
    return paymeResult(requestId, {
      transaction: transaction.id,
      create_time: transaction.create_time,
      perform_time: transaction.perform_time || 0,
      cancel_time: transaction.cancel_time || 0,
      state: transaction.state,
      reason: transaction.reason,
    });
  }

  if (method === "GetStatement") {
    const from = params?.from;
    const to = params?.to;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) {
      return paymeError(requestId, -32602, "Некорректный период.");
    }
    const statement = await env.DB.prepare(
      "SELECT * FROM payme_transactions WHERE create_time >= ? AND create_time <= ? ORDER BY create_time",
    ).bind(from, to).all();
    return paymeResult(requestId, {
      transactions: (statement.results || []).map((transaction) => ({
        id: transaction.id,
        time: transaction.create_time,
        amount: transaction.amount,
        account: { order_id: transaction.order_id },
        create_time: transaction.create_time,
        perform_time: transaction.perform_time || 0,
        cancel_time: transaction.cancel_time || 0,
        transaction: transaction.id,
        state: transaction.state,
        reason: transaction.reason,
      })),
    });
  }
  return paymeError(requestId, -32601, "Метод не поддерживается.");
}

function basicCredentials(header) {
  if (!header?.startsWith("Basic ")) return null;
  try {
    return atob(header.slice(6));
  } catch {
    return null;
  }
}

async function handlePayme(request, env) {
  if (!env.PAYME_KEY || !env.PAYME_MERCHANT_ID) return json({ error: "Service unavailable" }, 503);
  const credentials = basicCredentials(request.headers.get("authorization"));
  if (!credentials || !equalConstantTime(credentials, `Paycom:${env.PAYME_KEY}`)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "www-authenticate": 'Basic realm="Payme Merchant API"' },
    });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return paymeError(null, -32700, "Некорректный JSON.");
  }
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return paymeError(body?.id, -32600, "Некорректный запрос.");
  }
  try {
    return await handlePaymeMethod(body.method, body.params || {}, env, body.id);
  } catch (error) {
    console.error("Payme callback failed", body.method, error);
    return paymeError(body.id, -32400, "Внутренняя ошибка сервера.");
  }
}

function md5(value) {
  return createHash("md5").update(value, "utf8").digest("hex");
}

function clickSignatureMatches(form, env) {
  const signature = md5(
    `${form.click_trans_id}${form.service_id}${env.CLICK_SECRET_KEY}${form.merchant_trans_id}${form.amount}${form.action}${form.sign_time}`,
  );
  return equalConstantTime(signature.toLowerCase(), String(form.sign_string || "").toLowerCase());
}

function clickResponse(form, error, errorNote, prepareId = null) {
  return json({
    click_trans_id: form.click_trans_id ?? null,
    merchant_trans_id: form.merchant_trans_id ?? null,
    ...(Number(form.action) === 1
      ? { merchant_confirm_id: prepareId }
      : { merchant_prepare_id: prepareId }),
    error,
    error_note: errorNote,
  });
}

async function parseClickRequest(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return request.json();
  const formData = await request.formData();
  return Object.fromEntries(formData.entries());
}

async function handleClick(request, env) {
  if (!requiredEnv(env, ["CLICK_SECRET_KEY", "CLICK_SERVICE_ID"])) {
    return json({ error: "Service unavailable" }, 503);
  }
  let form;
  try {
    form = await parseClickRequest(request);
  } catch {
    return clickResponse({}, -2, "Некорректный запрос.");
  }
  if (String(form.service_id) !== String(env.CLICK_SERVICE_ID) || !clickSignatureMatches(form, env)) {
    return clickResponse(form, -1, "Ошибка подписи или service_id.");
  }
  const action = Number(form.action);
  if (action !== 0 && action !== 1) return clickResponse(form, -2, "Неизвестное действие.");
  if (!Number.isInteger(Number(form.error)) ||
      typeof form.click_trans_id !== "string" ||
      form.click_trans_id.length === 0 ||
      form.click_trans_id.length > 64) {
    return clickResponse(form, -2, "Некорректные данные транзакции.");
  }
  const callbackError = Number(form.error);
  if (action === 0 && callbackError !== 0) {
    return clickResponse(form, -2, "Click сообщил об ошибке платежа.");
  }
  const order = await env.DB.prepare("SELECT * FROM orders WHERE id = ?")
    .bind(String(form.merchant_trans_id || "")).first();
  if (!order) return clickResponse(form, -5, "Заказ не найден.");
  if (order.payment_provider !== "click") return clickResponse(form, -5, "Заказ не предназначен для Click.");
  const amount = Number(form.amount);
  if (!Number.isFinite(amount) || amount !== order.total_uzs) {
    return clickResponse(form, -2, "Сумма заказа не совпадает.");
  }

  if (action === 0) {
    const existing = await env.DB.prepare("SELECT * FROM click_transactions WHERE click_trans_id = ?")
      .bind(String(form.click_trans_id)).first();
    if (existing) {
      if (existing.order_id !== order.id || existing.amount !== order.total_uzs) {
        return clickResponse(form, -2, "Транзакция не совпадает с заказом.");
      }
      return clickResponse(form, 0, "Success", existing.click_trans_id);
    }
    if (order.status !== "pending") return clickResponse(form, -3, "Заказ уже оплачен или отменён.");
    const active = await env.DB.prepare(
      "SELECT click_trans_id FROM click_transactions WHERE order_id = ? AND status = 'prepared'",
    ).bind(order.id).first();
    if (active) return clickResponse(form, -3, "Для заказа уже есть активная транзакция.");
    await env.DB.prepare(
      `INSERT INTO click_transactions (click_trans_id, order_id, amount, status, created_at)
       VALUES (?, ?, ?, 'prepared', ?)`,
    ).bind(String(form.click_trans_id), order.id, order.total_uzs, Date.now()).run();
    return clickResponse(form, 0, "Success", String(form.click_trans_id));
  }

  const transaction = await env.DB.prepare("SELECT * FROM click_transactions WHERE click_trans_id = ?")
    .bind(String(form.click_trans_id)).first();
  if (!transaction || transaction.order_id !== order.id) {
    return clickResponse(form, -6, "Транзакция подготовки не найдена.");
  }
  if (String(form.merchant_prepare_id) !== transaction.click_trans_id) {
    return clickResponse(form, -6, "Идентификатор подготовки не совпадает.");
  }
  if (transaction.status === "completed" && order.status === "paid") {
    if (callbackError !== 0) return clickResponse(form, -3, "Заказ уже оплачен.");
    await sendOrderNotification(env, order.id);
    return clickResponse(form, 0, "Success", transaction.click_trans_id);
  }
  if (callbackError !== 0) {
    if (transaction.status === "prepared") {
      await env.DB.prepare(
        `UPDATE click_transactions SET status = 'cancelled', click_paydoc_id = ?, completed_at = ?
         WHERE click_trans_id = ? AND status = 'prepared' AND EXISTS (
           SELECT 1 FROM orders WHERE orders.id = click_transactions.order_id
             AND orders.status = 'pending'
         )`,
      ).bind(String(form.click_paydoc_id || ""), Date.now(), transaction.click_trans_id).run();
    }
    return clickResponse(form, 0, "Success", transaction.click_trans_id);
  }
  if (transaction.status !== "prepared" || !["pending", "paid"].includes(order.status)) {
    return clickResponse(form, -3, "Заказ уже оплачен или транзакция отменена.");
  }

  const completedAt = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE click_transactions SET status = 'completed', click_paydoc_id = ?, completed_at = ?
       WHERE click_trans_id = ? AND status = 'prepared' AND EXISTS (
         SELECT 1 FROM orders WHERE orders.id = click_transactions.order_id
           AND orders.payment_provider = 'click' AND orders.status IN ('pending', 'paid')
       )`,
    ).bind(String(form.click_paydoc_id || ""), completedAt, transaction.click_trans_id),
    env.DB.prepare(
      `UPDATE orders SET status = 'paid', paid_at = COALESCE(paid_at, ?)
       WHERE id = ? AND payment_provider = 'click' AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM click_transactions
           WHERE click_transactions.click_trans_id = ? AND click_transactions.order_id = orders.id
             AND click_transactions.status = 'completed'
         )`,
    ).bind(completedAt, order.id, transaction.click_trans_id),
  ]);
  const finalState = await env.DB.prepare(
    `SELECT click_transactions.status AS transaction_status, orders.status AS order_status
     FROM click_transactions JOIN orders ON orders.id = click_transactions.order_id
     WHERE click_transactions.click_trans_id = ?`,
  ).bind(transaction.click_trans_id).first();
  if (finalState?.transaction_status !== "completed" || finalState.order_status !== "paid") {
    return clickResponse(form, -3, "Не удалось подтвердить оплату заказа.");
  }
  await sendOrderNotification(env, order.id);
  return clickResponse(form, 0, "Success", transaction.click_trans_id);
}

async function retryNotifications(env) {
  const result = await env.DB.prepare(
    `SELECT id FROM orders
     WHERE status = 'paid' AND notification_sent_at IS NULL
       AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
     ORDER BY paid_at LIMIT 50`,
  ).bind(Date.now() - 120000).all();
  for (const row of result.results || []) {
    await sendOrderNotification(env, row.id);
  }

  const manualResult = await env.DB.prepare(
    `SELECT id FROM manual_transfer_orders
     WHERE notification_sent_at IS NULL
       AND (notification_claimed_at IS NULL OR notification_claimed_at < ?)
     ORDER BY created_at LIMIT 50`,
  ).bind(Date.now() - 120000).all();
  for (const row of manualResult.results || []) {
    await sendManualTransferNotification(env, row.id);
  }
}

async function handleManualOrderAdmin(request, env, cors) {
  if (!cors) return json({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (!requiredEnv(env, ["BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID"])) {
    return json({ error: "Панель владельца ещё не настроена." }, 503, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.initData !== "string" || body.initData.length > 8192) {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }

  let owner;
  try {
    owner = await verifyTelegramInitData(body.initData, env.BOT_TOKEN);
  } catch {
    return json({ error: "Откройте панель владельца из Telegram." }, 401, cors);
  }
  if (owner.id !== String(env.TELEGRAM_OWNER_CHAT_ID)) {
    return json({ error: "Доступ запрещён." }, 403, cors);
  }

  if (body.action === "list") {
    const result = await env.DB.prepare(
      `SELECT id, created_at, status, customer_telegram_id, customer_username,
         customer_first_name, language, total_uzs, deposit_uzs, transfer_uzs,
         tail_uzs, remaining_uzs, items_json
       FROM manual_transfer_orders
       WHERE status IN ('awaiting_transfer', 'partially_paid')
       ORDER BY created_at DESC LIMIT 50`,
    ).all();
    return json({
      orders: (result.results || []).map((order) => ({
        ...order,
        items: safeParseJson(order.items_json) || [],
        items_json: undefined,
      })),
    }, 200, cors);
  }

  if (!["confirm_deposit", "confirm_balance"].includes(body.action) ||
      typeof body.orderId !== "string" || body.orderId.length > 64) {
    return json({ error: "Некорректное действие." }, 400, cors);
  }

  const now = Date.now();
  const order = body.action === "confirm_deposit"
    ? await env.DB.prepare(
      `UPDATE manual_transfer_orders
       SET status = 'partially_paid', deposit_confirmed_at = ?
       WHERE id = ? AND status = 'awaiting_transfer'
       RETURNING id, status, remaining_uzs`,
    ).bind(now, body.orderId).first()
    : await env.DB.prepare(
      `UPDATE manual_transfer_orders
       SET status = 'paid', balance_confirmed_at = ?
       WHERE id = ? AND status = 'partially_paid'
       RETURNING id, status, remaining_uzs`,
    ).bind(now, body.orderId).first();

  if (!order) return json({ error: "Заказ не найден или уже изменён." }, 409, cors);
  return json({ order }, 200, cors);
}

async function handleCustomerOrderHistory(request, env, cors) {
  if (!cors) return json({ error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
  if (!requiredEnv(env, ["BOT_TOKEN"])) {
    return json({ error: "Сервер магазина ещё не настроен." }, 503, cors);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      typeof body.initData !== "string" || body.initData.length > 8192) {
    return json({ error: "Некорректный запрос." }, 400, cors);
  }

  let customer;
  try {
    customer = await verifyTelegramInitData(body.initData, env.BOT_TOKEN);
  } catch (error) {
    return json({ error: error.message }, 401, cors);
  }

  const [paymentResult, manualResult] = await Promise.all([
    env.DB.prepare(
      `SELECT id, created_at, status, payment_provider, total_uzs, items_json
       FROM orders WHERE customer_telegram_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).bind(customer.id).all(),
    env.DB.prepare(
      `SELECT id, created_at, status, total_uzs, deposit_uzs, transfer_uzs,
         tail_uzs, remaining_uzs, items_json
       FROM manual_transfer_orders
       WHERE customer_telegram_id = ?
         AND (status != 'awaiting_transfer' OR created_at > ?)
       ORDER BY created_at DESC LIMIT 50`,
    ).bind(customer.id, Date.now() - MANUAL_TRANSFER_WINDOW_MS).all(),
  ]);
  const mapOrder = (order, manual = false) => {
    const items = safeParseJson(order.items_json);
    const paymentDetails = manual &&
      ["awaiting_transfer", "partially_paid"].includes(order.status) &&
      requiredEnv(env, [
        "MANUAL_TRANSFER_BANK",
        "MANUAL_TRANSFER_CARDHOLDER",
        "MANUAL_TRANSFER_CARD_NUMBER",
      ])
      ? {
          bank: env.MANUAL_TRANSFER_BANK,
          cardholder: env.MANUAL_TRANSFER_CARDHOLDER,
          cardNumber: env.MANUAL_TRANSFER_CARD_NUMBER,
        }
      : null;
    return {
      id: order.id,
      created_at: order.created_at,
      status: order.status,
      payment_provider: manual ? "manual_transfer" : order.payment_provider,
      total_uzs: order.total_uzs,
      deposit_uzs: manual ? order.deposit_uzs : null,
      transfer_uzs: manual ? order.transfer_uzs : null,
      tail_uzs: manual ? order.tail_uzs : null,
      remaining_uzs: manual ? order.remaining_uzs : null,
      payment_details: paymentDetails,
      items: Array.isArray(items) ? items : [],
    };
  };
  const orders = [
    ...(paymentResult.results || []).map((order) => mapOrder(order)),
    ...(manualResult.results || []).map((order) => mapOrder(order, true)),
  ].sort((left, right) => right.created_at - left.created_at).slice(0, 50);

  return json({ orders }, 200, cors);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, env);
  if (url.pathname === "/health" && request.method === "GET") {
    return json({
      ok: true,
      configured: {
        telegram: requiredEnv(env, ["BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID"]),
        payme: requiredEnv(env, ["PAYME_KEY", "PAYME_MERCHANT_ID"]),
        click: requiredEnv(env, ["CLICK_SECRET_KEY", "CLICK_SERVICE_ID", "CLICK_MERCHANT_ID"]),
        manualTransfer: requiredEnv(env, [
          "MANUAL_TRANSFER_BANK",
          "MANUAL_TRANSFER_CARDHOLDER",
          "MANUAL_TRANSFER_CARD_NUMBER",
        ]),
      },
    });
  }
  if (url.pathname === "/api/payments/payme" && request.method === "POST") return handlePayme(request, env);
  if (url.pathname === "/api/payments/click" && request.method === "POST") return handleClick(request, env);

  if (url.pathname === "/api/manual-orders/admin") {
    if (Number(request.headers.get("content-length") || 0) > 20000) {
      return json({ error: "Request is too large." }, 413, cors || {});
    }
    return handleManualOrderAdmin(request, env, cors);
  }

  if (url.pathname === "/api/orders/history") {
    if (Number(request.headers.get("content-length") || 0) > 20000) {
      return json({ error: "Request is too large." }, 413, cors || {});
    }
    return handleCustomerOrderHistory(request, env, cors);
  }

  if (url.pathname === "/api/orders") {
    if (!cors) return json({ error: "Origin is not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, cors);
    const length = Number(request.headers.get("content-length") || 0);
    if (length > 20000) return json({ error: "Request is too large." }, 413, cors);
    return createOrder(request, env, cors);
  }
  return json({ error: "Not found." }, 404);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
  scheduled(_controller, env, context) {
    context.waitUntil(retryNotifications(env));
  },
};

export { clickSignatureMatches, handlePaymeMethod, validateCart, verifyTelegramInitData };
