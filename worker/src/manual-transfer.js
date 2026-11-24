export function calculateTransferAmounts(total, tail) {
  if (!Number.isSafeInteger(total) || total < 2) {
    throw new Error("Некорректная сумма заказа.");
  }
  if (!Number.isInteger(tail) || tail < 1 || tail > 99) {
    throw new Error("Некорректный код перевода.");
  }

  const depositAmount = Math.ceil(total / 2);
  const transferAmount = depositAmount + tail;
  if (transferAmount >= total) {
    throw new Error("Сумма предоплаты превышает сумму заказа.");
  }

  return {
    depositAmount,
    transferAmount,
    remainingAmount: total - depositAmount,
    tail,
  };
}
