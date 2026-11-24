# Заказы и оплата XEVEN WEAR

Worker принимает заказы мини-приложения, пересчитывает сумму по серверному каталогу и проверяет подпись `initData` Telegram. Сейчас доступна ручная предоплата: клиент переводит половину заказа плюс уникальный хвост сверху, а остаток остаётся ровно второй половиной (для нечётной суммы половины округляются до целых сумов). Хвост не уменьшает остаток. Владелец подтверждает поступление только после проверки в банковском приложении. Заказы и уведомления хранятся в D1; владелец получает в Telegram состав заказа, фотографии, сумму и ссылку на покупателя. Покупатель видит только собственные заказы в профиле Mini App; для неоплаченных переводов там доступны реквизиты и точная сумма. История защищена проверкой `initData`. Тестовый товар за 1 000 сум доступен только владельцу и проверяется сервером. Корзина сохраняется в `localStorage` Mini App. Коды из SMS/банковского приложения не собираются и не читаются. Payme/Click Merchant API остаются доступными после официального подключения мерчанта.

## Развёртывание

Установите Wrangler из каталога `worker`:
```powershell
npm install
```
Остальные команды этого раздела также выполняйте из каталога `worker`.

1. Создайте D1 и сохраните его идентификатор:
   ```powershell
   npx wrangler d1 create xevenwear-orders
   ```
   Подставьте выданный `database_id` в `wrangler.toml`.
2. Примените схему:
   ```powershell
   npx wrangler d1 execute xevenwear-orders --remote --file=.\schema.sql
   ```
3. Настройте Telegram и реквизиты ручного перевода. Выполняйте каждую команду отдельно; Wrangler запросит значение. Не записывайте эти значения в репозиторий и не отправляйте их в чат:
   ```powershell
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put TELEGRAM_OWNER_CHAT_ID
   npx wrangler secret put MANUAL_TRANSFER_BANK
   npx wrangler secret put MANUAL_TRANSFER_CARDHOLDER
   npx wrangler secret put MANUAL_TRANSFER_CARD_NUMBER
   ```
   `BOT_TOKEN` — токен `@XevenWearBot`; `TELEGRAM_OWNER_CHAT_ID` — числовой Telegram ID владельца. Реквизиты перевода передаются покупателю только после проверки Telegram `initData`; храните их в Cloudflare Secrets.
4. Когда появятся официальные Merchant API данные, добавьте их отдельно:
   ```powershell
   npx wrangler secret put PAYME_MERCHANT_ID
   npx wrangler secret put PAYME_KEY
   npx wrangler secret put CLICK_MERCHANT_ID
   npx wrangler secret put CLICK_SERVICE_ID
   npx wrangler secret put CLICK_SECRET_KEY
   ```
5. Из каталога `worker` разверните API:
   ```powershell
   npx wrangler deploy
   ```
6. После развёртывания опубликуйте обновлённый GitHub Pages сайт. В `index.html` уже указан URL Worker.
7. Ручная предоплата считается подтверждённой только после того, как владелец проверит реальное поступление в банке и отметит его в профиле Mini App. Уникальный хвост помогает сопоставить перевод, но сам по себе не является подтверждением и оплачивается сверх половины заказа. Остаток также отмечается вручную после фактического поступления.
8. Для официальных платежей в кабинетах Payme Business и Click укажите callback URL:
   - Payme Merchant API: `https://<worker>.workers.dev/api/payments/payme`
   - Click Shop API: `https://<worker>.workers.dev/api/payments/click`

Добавьте полученные ID и ключи в Worker по командам выше. Проверьте callbacks на тестовом контуре до включения реальных платежей. Для Payme/Click статус оплаты определяется только проверенным серверным callback.

Уведомления с временной ошибкой Telegram автоматически повторяются Worker по расписанию раз в пять минут. Чтобы владелец мог связаться с покупателем, бот должен иметь возможность открыть профиль пользователя; ссылка включается в уведомление.

Официальные спецификации: [Payme Merchant API](https://developer.help.paycom.uz/) и [Click Shop API](https://docs.click.uz/).
