const clothingSizes = ["S", "M", "L", "XL", "XXL", "XXXL"];
const shoeSizes = ["36", "37", "38", "39", "40", "41", "42", "43", "44"];

const colors = (entries) => entries.map(([key, image]) => ({ key, image }));
const simpleSizes = (sizes) => ({ sizes });
const groupedSizes = (...groups) => ({ sizeGroups: groups });

export const catalog = {
  7: {
    name: { ru: "Джинсы багги", uz: "Baggy jinsilar" },
    price: 250000,
    colors: colors([["lightgray", "images/jeans-light.jpg"], ["black", "images/jeans-black.jpg"]]),
    ...simpleSizes(clothingSizes),
  },
  8: {
    name: { ru: "Куртка-бомбер с меховым воротником", uz: "Mo‘ynali yoqali bomber kurtka" },
    price: 350000,
    colors: colors([["beige", "images/jacket-light.jpg"], ["black", "images/jacket-black.jpg"]]),
    ...simpleSizes(clothingSizes),
  },
  9: {
    name: { ru: "Лук №1", uz: "Look №1" },
    price: 800000,
    colors: colors([
      ["black", "images/oversize-black.png"],
      ["blue-white", "images/oversize-blue-white.png"],
      ["black-white", "images/oversize-black-white.png"],
      ["gray-white", "images/oversize-gray-white.png"],
      ["gray-black", "images/oversize-gray-black.png"],
    ]),
    ...groupedSizes(
      ["jacketSize", clothingSizes],
      ["jeansSize", clothingSizes],
      ["sneakersSize", shoeSizes],
    ),
  },
  10: {
    name: { ru: "Лук №2", uz: "Look №2" },
    price: 600000,
    colors: colors([["white", "images/fur-oversize-white.png"], ["black", "images/fur-oversize-black.png"]]),
    ...groupedSizes(["jacketSize", clothingSizes], ["jeansSize", clothingSizes]),
  },
  11: {
    name: { ru: "Дутый пуховик с эффектом худи", uz: "Hudiga o‘xshash shishma kurtka" },
    price: 350000,
    colors: colors([
      ["black", "images/jacket-black.png"],
      ["blue", "images/jacket-blue.png"],
      ["gray", "images/jacket-gray.png"],
    ]),
    ...simpleSizes(clothingSizes),
  },
  12: {
    name: { ru: "Nike Air Force 1", uz: "Nike Air Force 1" },
    price: 200000,
    colors: colors([["black", "images/sneakers-black.png"], ["white", "images/sneakers-white.png"]]),
    ...simpleSizes(shoeSizes),
  },
  13: {
    name: { ru: "Лук №3", uz: "Look №3" },
    price: 900000,
    colors: colors([
      ["white", "images/oversize-set-white.png"],
      ["blue", "images/oversize-set-blue.png"],
      ["black", "images/oversize-set-black.png"],
    ]),
    ...groupedSizes(
      ["jacketSize", clothingSizes],
      ["hoodieSize", clothingSizes],
      ["pantsSize", clothingSizes],
      ["sneakersSize", shoeSizes],
    ),
  },
  14: {
    name: { ru: "Объёмный пуховик в стиле NASA", uz: "NASA uslubidagi hajmli kurtka" },
    price: 300000,
    colors: colors([
      ["white", "images/separate-jacket-white.png"],
      ["black", "images/separate-jacket-black.png"],
    ]),
    ...simpleSizes(clothingSizes),
  },
  15: {
    name: { ru: "Широкие трикотажные джоггеры", uz: "Keng trikotaj joggerlar" },
    price: 150000,
    colors: colors([
      ["white", "images/separate-pants-white.png"],
      ["blue", "images/separate-pants-blue.png"],
      ["black", "images/separate-pants-black.png"],
    ]),
    ...simpleSizes(clothingSizes),
  },
  16: {
    name: { ru: "Базовое оверсайз худи с карманом-кенгуру", uz: "Keng bichimli asosiy xudi" },
    price: 150000,
    colors: colors([
      ["white", "images/separate-hoodie-white.png"],
      ["blue", "images/separate-hoodie-blue.png"],
      ["black", "images/separate-hoodie-black.png"],
    ]),
    ...simpleSizes(clothingSizes),
  },
  17: {
    name: { ru: "Nike Dunk", uz: "Nike Dunk" },
    price: 150000,
    colors: colors([["default", "images/nike-dunk.png"]]),
    ...simpleSizes(shoeSizes),
  },
};

const colorNames = {
  ru: {
    lightgray: "Светло-серый",
    beige: "Бежевый",
    black: "Чёрный",
    "blue-white": "Синий-белый",
    "black-white": "Чёрно-белый",
    "gray-white": "Серо-белый",
    "gray-black": "Серо-чёрный",
    white: "Белый",
    blue: "Синий",
    gray: "Серый",
    default: "Стандартный",
  },
  uz: {
    lightgray: "Och kulrang",
    beige: "Bej",
    black: "Qora",
    "blue-white": "Ko‘k-oq",
    "black-white": "Qora-oq",
    "gray-white": "Kulrang-oq",
    "gray-black": "Kulrang-qora",
    white: "Oq",
    blue: "Ko‘k",
    gray: "Kulrang",
    default: "Standart",
  },
};

export function validateCart(input, language = "ru") {
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) {
    throw new Error("Корзина пуста или содержит слишком много позиций.");
  }

  const items = input.map((requested) => {
    if (!requested || !Number.isInteger(requested.id) || !catalog[requested.id]) {
      throw new Error("В корзине есть неизвестный товар.");
    }

    const product = catalog[requested.id];
    const quantity = requested.quantity;
    const colorIndex = requested.colorIndex ?? 0;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error("Некорректное количество товара.");
    }
    if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex >= product.colors.length) {
      throw new Error("Некорректный вариант цвета.");
    }

    const expectedSizeKeys = product.sizeGroups
      ? product.sizeGroups.map(([key]) => key)
      : ["size"];
    const sizes = requested.sizes;
    if (!sizes || typeof sizes !== "object" || Array.isArray(sizes)) {
      throw new Error("Необходимо выбрать размер.");
    }
    const submittedKeys = Object.keys(sizes).sort();
    if (submittedKeys.join(",") !== [...expectedSizeKeys].sort().join(",")) {
      throw new Error("Некорректный набор размеров.");
    }
    for (const key of expectedSizeKeys) {
      const allowed = product.sizeGroups
        ? product.sizeGroups.find(([groupKey]) => groupKey === key)[1]
        : product.sizes;
      if (!allowed.includes(sizes[key])) {
        throw new Error("Выбран недопустимый размер.");
      }
    }

    const color = product.colors[colorIndex];
    const sizeLabel = expectedSizeKeys
      .map((key) => `${key}: ${sizes[key]}`)
      .join(", ");
    const unitPrice = product.price;
    return {
      id: requested.id,
      name: product.name[language] || product.name.ru,
      color: colorNames[language]?.[color.key] || colorNames.ru[color.key],
      image: color.image,
      sizes,
      sizeLabel,
      quantity,
      unitPrice,
      totalPrice: unitPrice * quantity,
    };
  });

  const total = items.reduce((sum, item) => sum + item.totalPrice, 0);
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new Error("Некорректная сумма заказа.");
  }
  return { items, total };
}
