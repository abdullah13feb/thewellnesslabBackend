import { Router, Request, Response } from "express";
import axios from "axios";
import prisma from "../lib/prisma.js";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "../lib/email.js";
import { sendMetaPurchase } from "./paymob.js";
import { clearCart } from "../lib/cart.js";

const router = Router();

const TABBY_API = "https://api.tabby.ai";
const TABBY_SECRET_KEY = (process.env.TABBY_SECRET_KEY || process.env.TABBY_SECRET || "").trim();
const TABBY_PUBLIC_KEY = (process.env.TABBY_PUBLIC_KEY || "").trim();
const TABBY_MERCHANT_CODE = (process.env.TABBY_MERCHANT_CODE || "").trim();
// Optional: the header value set when registering the webhook with Tabby.
const TABBY_WEBHOOK_SECRET = (process.env.TABBY_WEBHOOK_SECRET || "").trim();

const tabbyHeaders = () => ({
  Authorization: `Bearer ${TABBY_SECRET_KEY}`,
  "Content-Type": "application/json",
});

const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// Tabby accepts +971500000001, 971500000001, 0500000001 or 500000001; the checkout form allows spaces and dashes.
const normalizePhone = (v: unknown) => {
  const s = clean(v);
  if (!s) return undefined;
  const digits = s.replace(/[^\d+]/g, "");
  return digits.replace(/\d/g, "").length > 1 || digits.replace(/\D/g, "").length < 7 ? undefined : digits;
};

const phoneTail = (v: unknown) => (normalizePhone(v) || "").replace(/\D/g, "").slice(-9);

// Drops undefined fields so Tabby never receives empty strings or placeholders.
const compact = <T extends Record<string, unknown>>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")) as Partial<T>;

const HISTORY_STATUS: Record<string, string> = {
  PENDING: "new",
  PROCESSING: "processing",
  SHIPPED: "processing",
  DELIVERED: "complete",
  CANCELLED: "canceled",
};

/**
 * Builds buyer_history and order_history from the customer's earlier orders, matched by account,
 * email or phone (guests have no account). Abandoned online orders that were never paid are not purchases.
 */
async function buyerContext(opts: { userId?: string | null; email?: string; phone?: string; excludeOrderId?: string }) {
  const email = clean(opts.email)?.toLowerCase();
  const tail = phoneTail(opts.phone);
  const user = opts.userId ? await prisma.user.findUnique({ where: { id: opts.userId } }) : null;

  const or: any[] = [];
  if (opts.userId) or.push({ userId: opts.userId });
  if (email) or.push({ guestEmail: { equals: email, mode: "insensitive" } });
  if (tail.length >= 7) or.push({ guestPhone: { contains: tail.slice(-4) } });

  const candidates = or.length
    ? await prisma.order.findMany({
        where: {
          OR: or,
          ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
          AND: [{ OR: [{ paymentStatus: "paid" }, { paymentMethod: "cod" }] }],
        },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  const previous = candidates.filter(
    (o) =>
      (opts.userId && o.userId === opts.userId) ||
      (email && o.guestEmail?.toLowerCase() === email) ||
      (tail.length >= 7 && phoneTail(o.guestPhone) === tail)
  );

  const firstSeen = previous.reduce<Date | null>((min, o) => (!min || o.createdAt < min ? o.createdAt : min), null);
  const registeredSince = user?.createdAt || firstSeen || new Date();

  return {
    buyer_history: {
      registered_since: registeredSince.toISOString(),
      loyalty_level: previous.filter((o) => o.status !== "CANCELLED").length,
    },
    order_history: previous.slice(0, 10).map((o) => ({
      purchased_at: o.createdAt.toISOString(),
      amount: money(o.totalPrice),
      payment_method: o.paymentMethod === "cod" ? "cod" : "card",
      status: HISTORY_STATUS[o.status] || "unknown",
      buyer: compact({ name: clean(o.guestName), email: clean(o.guestEmail), phone: normalizePhone(o.guestPhone) }),
      shipping_address: compact({ city: clean(o.city), address: clean(o.address), zip: clean(o.pincode) }),
      items: o.items.map((it) =>
        compact({
          reference_id: it.productId,
          title: it.product?.name || undefined,
          quantity: it.quantity,
          unit_price: money(it.price),
          category: it.product?.category || "Wellness",
        })
      ),
    })),
  };
}

/** Public key and merchant code for the on-site snippets. Both are safe to expose; the secret key never is. */
router.get("/config", (_req: Request, res: Response) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ success: true, publicKey: TABBY_PUBLIC_KEY || null, merchantCode: TABBY_MERCHANT_CODE || null });
});

/**
 * Background pre-scoring: asks Tabby whether this shopper would be approved before they choose Tabby.
 * Any error or timeout answers "available" so Tabby stays visible, as Tabby recommends.
 */
router.post("/prescore", async (req: Request, res: Response) => {
  const available = () => res.json({ success: true, available: true });
  try {
    if (!TABBY_SECRET_KEY || !TABBY_MERCHANT_CODE) return available();

    const amount = Number(req.body?.amount);
    const email = clean(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    if (!(amount > 0) || amount > 1_000_000 || !email || !phone) {
      return res.status(400).json({ success: false, error: "amount, email and phone are required" });
    }

    const items: any[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 50) : [];
    const history = await buyerContext({ userId: req.auth?.userId, email, phone });

    const payload = {
      payment: {
        amount: money(amount),
        currency: "AED",
        buyer: compact({ email, phone, name: clean(req.body?.name) }),
        ...(items.length
          ? {
              order: {
                reference_id: `prescore-${Date.now()}`,
                items: items.map((it) =>
                  compact({
                    reference_id: clean(String(it.productId ?? "")),
                    title: clean(it.name) || "Item",
                    quantity: Math.max(1, Number(it.quantity) || 1),
                    unit_price: money(it.price),
                    category: "Wellness",
                  })
                ),
              },
            }
          : {}),
        ...history,
      },
      lang: "en",
      merchant_code: TABBY_MERCHANT_CODE,
    };

    const { data } = await axios.post(`${TABBY_API}/api/v2/checkout`, payload, { headers: tabbyHeaders(), timeout: 8000 });

    if (data?.status === "rejected") {
      const reason = data?.configuration?.products?.installments?.rejection_reason;
      return res.json({ success: true, available: false, reason: reason || "not_available", message: rejectionMessage(reason) });
    }
    return available();
  } catch (error: any) {
    console.error("Tabby pre-scoring error:", error?.response?.data || error.message || error);
    return available();
  }
});

/**
 * Create a Tabby checkout session for an order and return the hosted payment URL.
 * Tabby can reject a shopper up front (e.g. amount out of range); that reason is returned as `error`.
 */
router.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ success: false, error: "Order ID is required" });
    if (!TABBY_SECRET_KEY || !TABBY_MERCHANT_CODE) {
      return res.status(500).json({ success: false, error: "Tabby is not configured (TABBY_SECRET_KEY / TABBY_MERCHANT_CODE)." });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, user: true },
    });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    if (order.paymentStatus === "paid") return res.status(400).json({ success: false, error: "Order is already paid" });

    const clientUrl = returnOrigin(req.body?.returnOrigin);
    const returnUrl = (result: string) =>
      `${clientUrl}/payment/success?orderId=${order.id}&gateway=tabby&result=${result}`;

    const email = clean(order.guestEmail) || clean(order.user?.email);
    const phone = normalizePhone(order.guestPhone);
    const history = await buyerContext({ userId: order.userId, email, phone, excludeOrderId: order.id });

    const payload = {
      payment: {
        amount: money(order.totalPrice),
        currency: "AED",
        description: `The Wellness Lab order ${order.id}`,
        buyer: compact({ phone, email, name: clean(order.guestName) }),
        shipping_address: {
          city: order.city,
          address: order.address,
          // Tabby requires zip; the UAE has no postcodes, so the checkout form sends 00000.
          zip: clean(order.pincode) || "00000",
        },
        order: {
          reference_id: order.id,
          tax_amount: "0.00",
          shipping_amount: money(order.shippingCharge),
          discount_amount: money(order.discount),
          updated_at: order.updatedAt.toISOString(),
          items: order.items.map((it) =>
            compact({
              reference_id: it.productId,
              title: it.product?.name || "Item",
              quantity: it.quantity,
              unit_price: money(it.price),
              discount_amount: "0.00",
              category: it.product?.category || "Wellness",
              image_url: clean(it.product?.image),
            })
          ),
        },
        ...history,
        meta: { order_id: order.id },
      },
      lang: "en",
      merchant_code: TABBY_MERCHANT_CODE,
      merchant_urls: {
        success: returnUrl("success"),
        cancel: returnUrl("cancel"),
        failure: returnUrl("failure"),
      },
    };

    const { data } = await axios.post(`${TABBY_API}/api/v2/checkout`, payload, { headers: tabbyHeaders() });

    const webUrl: string | undefined = data?.configuration?.available_products?.installments?.[0]?.web_url;
    if (data?.status !== "created" || !webUrl) {
      const reason = data?.configuration?.products?.installments?.rejection_reason;
      return res.status(400).json({ success: false, rejected: true, reason, error: rejectionMessage(reason) });
    }

    res.json({ success: true, url: webUrl, sessionId: data.id, paymentId: data.payment?.id });
  } catch (error: any) {
    console.error("Tabby Checkout Error:", error?.response?.data || error.message || error);
    res.status(500).json({
      success: false,
      error: error?.response?.data?.error || "Failed to start Tabby checkout. Please try another payment method.",
    });
  }
});

// Shoppers return to the storefront they paid from (live site, an Amplify branch such as staging, or local dev).
// Anything else falls back to CLIENT_URL, so the redirect can't be pointed at another site.
const ALLOWED_RETURN_ORIGIN = /^https:\/\/((www\.)?thewellnesslab\.ae|[a-z0-9-]+\.d33xlkpzqgsah0\.amplifyapp\.com)$|^http:\/\/localhost:\d+$/;

function returnOrigin(requested: unknown) {
  const fallback = (process.env.CLIENT_URL || "https://www.thewellnesslab.ae").trim();
  if (typeof requested !== "string") return fallback;
  const origin = requested.trim().replace(/\/+$/, "");
  return ALLOWED_RETURN_ORIGIN.test(origin) ? origin : fallback;
}

// Tabby's official customer-facing rejection texts.
function rejectionMessage(reason?: string) {
  switch (reason) {
    case "order_amount_too_high":
      return "This purchase is above your current spending limit with Tabby, try a smaller cart or use another payment method";
    case "order_amount_too_low":
      return "The purchase amount is below the minimum amount required to use Tabby, try adding more items or use another payment method";
    default:
      return "Sorry, Tabby is unable to approve this purchase. Please use an alternative payment method for your order.";
  }
}

/**
 * Look the payment up on Tabby (never trust the browser or webhook body), check it belongs to the
 * order and matches the amount, capture it if only authorized, then mark the order paid.
 */
async function processTabbyPayment(paymentId: string, expectedOrderId?: string) {
  const { data: payment } = await axios.get(`${TABBY_API}/api/v2/payments/${paymentId}`, { headers: tabbyHeaders() });

  const orderId: string = payment?.order?.reference_id;
  if (!orderId || (expectedOrderId && orderId !== expectedOrderId)) {
    return { paid: false, reason: "Payment does not belong to this order" };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { paid: false, reason: "Order not found" };
  if (order.paymentStatus === "paid") return { paid: true, orderId };

  if (payment.currency !== "AED" || Math.abs(Number(payment.amount) - order.totalPrice) > 0.01) {
    console.error("Tabby amount mismatch", { orderId, paid: payment.amount, expected: order.totalPrice });
    return { paid: false, reason: "Amount mismatch" };
  }

  let status = String(payment.status || "").toUpperCase();
  if (status === "AUTHORIZED") {
    const { data: captured } = await axios.post(
      `${TABBY_API}/api/v2/payments/${paymentId}/captures`,
      { amount: money(order.totalPrice), reference_id: orderId },
      { headers: tabbyHeaders() }
    );
    status = String(captured?.status || "").toUpperCase();
  }

  if (status !== "CLOSED") return { paid: false, reason: `Tabby status ${status}` };

  // Only the first caller flips the order to paid, so emails go out once.
  const claim = await prisma.order.updateMany({
    where: { id: orderId, paymentStatus: { not: "paid" } },
    data: { paymentStatus: "paid", status: "PROCESSING", paymentMethod: "tabby" },
  });

  if (claim.count > 0) {
    const updated = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, user: true },
    });
    // The cart is kept until payment succeeds; the success page clears guest carts in the browser.
    if (updated?.userId) {
      try {
        await clearCart({ userId: updated.userId });
      } catch (err) {
        console.error("Failed to clear cart after Tabby payment:", err);
      }
    }
    if (updated) {
      const userEmail = updated.guestEmail || updated.user?.email || null;
      try {
        if (userEmail) await sendOrderConfirmationEmail({ ...updated, userEmail });
      } catch (err) {
        console.error("Failed to send Tabby order confirmation email:", err);
      }
      try {
        await sendOrderNotificationEmail(updated);
      } catch (err) {
        console.error("Failed to send admin notification email for Tabby order:", err);
      }
      try {
        await sendMetaPurchase(orderId);
      } catch (err) {
        console.error("Meta CAPI Purchase error (Tabby):", err);
      }
    }
  }

  return { paid: true, orderId };
}

/**
 * Called by /payment/success after Tabby redirects back with ?payment_id=...
 */
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { orderId, paymentId } = req.body;
    if (!orderId || !paymentId) {
      return res.status(400).json({ success: false, error: "Order ID and payment ID are required" });
    }

    const result = await processTabbyPayment(String(paymentId), String(orderId));
    if (!result.paid) return res.json({ success: false, message: result.reason });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });
    res.json({ success: true, order });
  } catch (error: any) {
    console.error("Verify Tabby Payment Error:", error?.response?.data || error.message || error);
    res.status(500).json({ success: false, error: "Tabby payment verification failed" });
  }
});

/**
 * Tabby webhook. Register it once with Tabby:
 *   POST https://api.tabby.ai/api/v1/webhooks  (header X-Merchant-Code)
 *   { "url": "<API>/api/tabby/webhook", "header": { "title": "X-Webhook-Secret", "value": "<TABBY_WEBHOOK_SECRET>" } }
 */
router.post("/webhook", async (req: Request, res: Response) => {
  try {
    if (TABBY_WEBHOOK_SECRET && req.get("X-Webhook-Secret") !== TABBY_WEBHOOK_SECRET) {
      return res.status(401).json({ success: false });
    }

    const paymentId = req.body?.id;
    const status = String(req.body?.status || "").toLowerCase();
    if (paymentId && (status === "authorized" || status === "closed")) {
      await processTabbyPayment(String(paymentId));
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Tabby Webhook Error:", error?.response?.data || error.message || error);
    // Non-2xx makes Tabby retry the delivery.
    res.status(500).json({ success: false });
  }
});

export default router;
