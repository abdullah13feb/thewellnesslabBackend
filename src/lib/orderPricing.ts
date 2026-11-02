import prisma from "./prisma.js";
import { linePrice, lineQuantity } from "./pricing.js";

export type PricedLine = { productId: string; quantity: number; price: number; [k: string]: any };

export type PricedOrder =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      items: PricedLine[];
      subtotal: number;
      shippingCharge: number;
      discount: number;
      total: number;
      couponCode: string | null;
    };

/**
 * Server-side price of a cart: catalog prices, shipping from settings and the coupon.
 * Used by order creation and by the embedded Paymob payment so both charge the same amount.
 */
export async function priceOrder(requestedItems: any, couponCode?: string | null): Promise<PricedOrder> {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    return { ok: false, status: 400, error: "Items array is required" };
  }

  const requestedIds = requestedItems.map((it: any) => String(it.productId || it.id || ""));
  const catalog = await prisma.product.findMany({
    where: { OR: [{ id: { in: requestedIds } }, { slug: { in: requestedIds } }] },
  });
  const catalogById = new Map<string, (typeof catalog)[number]>();
  catalog.forEach((p) => {
    catalogById.set(p.id, p);
    catalogById.set(p.slug, p);
  });
  if (requestedIds.some((id: string) => !catalogById.has(id))) {
    return { ok: false, status: 400, error: "A product in your cart is no longer available. Please refresh your cart." };
  }
  const items: PricedLine[] = requestedItems.map((it: any, i: number) => {
    const product = catalogById.get(requestedIds[i])!;
    return {
      ...it,
      productId: product.id,
      quantity: lineQuantity(it.quantity),
      price: linePrice(product, it.price),
    };
  });

  const subtotal = items.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);

  const shippingSetting = await prisma.setting.findUnique({ where: { key: "shipping_cost" } });
  let shippingCharge = 0;
  if (shippingSetting && shippingSetting.value) {
    const parsed = parseFloat(shippingSetting.value);
    shippingCharge = isNaN(parsed) ? 0 : parsed;
  }

  let discount = 0;
  let validatedCouponCode: string | null = null;

  if (couponCode) {
    const coupon = await prisma.coupon.findUnique({
      where: { code: String(couponCode).toUpperCase(), isActive: true },
    });

    if (coupon) {
      const isExpired = coupon.expiry && new Date(coupon.expiry) < new Date();
      const meetsMinPurchase = subtotal >= coupon.minPurchase;

      if (!isExpired && meetsMinPurchase) {
        let eligibleSubtotal = subtotal;
        let isEligible = true;

        if (coupon.applicableProducts && coupon.applicableProducts.length > 0) {
          const productIds = (items || []).map((it: any) => String(it.productId || it.id || ""));
          const dbProducts = await prisma.product.findMany({
            where: { OR: [{ id: { in: productIds } }, { slug: { in: productIds } }] },
            select: { id: true, slug: true, name: true },
          });

          const productMap = new Map<string, { id: string; slug: string; name: string }>();
          dbProducts.forEach((p) => {
            productMap.set(p.id, p);
            productMap.set(p.slug, p);
          });

          const allowedSet = new Set(coupon.applicableProducts.map((p) => p.toLowerCase().trim()));

          const eligibleItems = (items || []).filter((item: any) => {
            const rawId = String(item.productId || item.id || "");
            const rawName = String(item.name || "").toLowerCase();
            const dbProduct = productMap.get(rawId);
            const dbSlug = dbProduct?.slug?.toLowerCase();
            const dbId = dbProduct?.id?.toLowerCase();
            const dbName = dbProduct?.name?.toLowerCase();

            for (const allowed of allowedSet) {
              if (allowed === rawId.toLowerCase()) return true;
              if (dbSlug && allowed === dbSlug) return true;
              if (dbId && allowed === dbId) return true;
              if (allowed.includes("pro") && (rawName.includes("rex pro") || (dbName && dbName.includes("rex pro")))) return true;
              if (allowed.includes("core") && (rawName.includes("rex core") || (dbName && dbName.includes("rex core")))) return true;
              if (allowed.includes("ultra") && (rawName.includes("rex ultra") || (dbName && dbName.includes("rex ultra")))) return true;
              if (allowed.includes("prestige") && (rawName.includes("rex prestige") || (dbName && dbName.includes("rex prestige")))) return true;
            }
            return false;
          });

          if (eligibleItems.length === 0) {
            isEligible = false;
          } else {
            eligibleSubtotal = eligibleItems.reduce((sum: number, it: any) => {
              const itemPrice = Number(it.price) || 0;
              const itemQty = Number(it.quantity) || 1;
              return sum + itemPrice * itemQty;
            }, 0);
          }
        }

        if (isEligible) {
          if (coupon.type === "PERCENTAGE") {
            discount = (eligibleSubtotal * coupon.discount) / 100;
          } else {
            discount = Math.min(coupon.discount, eligibleSubtotal);
          }
          validatedCouponCode = coupon.code;
        }
      }
    }
  }

  return {
    ok: true,
    items,
    subtotal,
    shippingCharge,
    discount,
    total: subtotal + shippingCharge - discount,
    couponCode: validatedCouponCode,
  };
}

/** Paymob amounts are integer fils (cents). */
export const toCents = (amount: number) => Math.round((Number(amount) || 0) * 100);
