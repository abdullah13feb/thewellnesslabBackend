// Every cart and order line is priced here from the product saved in Products, never from the price
// the browser sends. The browser's price is only read to tell whether the Motorized Stand was chosen.
export const MOTORIZED_STAND_PRICE = 4000;

const NO_STAND = /ultra|mini|pet|pod/i;

type PricedProduct = { price: number; slug?: string | null; name?: string | null };

export function linePrice(product: PricedProduct, requestedPrice: unknown): number {
  const base = Number(product.price) || 0;
  const requested = Number(requestedPrice);
  const standAllowed = !NO_STAND.test(`${product.slug || ""} ${product.name || ""}`);
  const withStand =
    standAllowed && Number.isFinite(requested) && requested - base >= MOTORIZED_STAND_PRICE / 2;
  return base + (withStand ? MOTORIZED_STAND_PRICE : 0);
}

export function lineQuantity(value: unknown): number {
  const qty = Math.floor(Number(value));
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}
