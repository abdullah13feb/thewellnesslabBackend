import { Router, Request, Response } from "express";
import axios from "axios";
import prisma from "../lib/prisma.js";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "../lib/email.js";
import { sendMetaPurchase } from "./paymob.js";

const router = Router();

const TABBY_API = "https://api.tabby.ai";
const TABBY_SECRET_KEY = (process.env.TABBY_SECRET_KEY || process.env.TABBY_SECRET || "").trim();
const TABBY_MERCHANT_CODE = (process.env.TABBY_MERCHANT_CODE || "").trim();
// Optional: the header value set when registering the webhook with Tabby.
const TABBY_WEBHOOK_SECRET = (process.env.TABBY_WEBHOOK_SECRET || "").trim();

const tabbyHeaders = () => ({
  Authorization: `Bearer ${TABBY_SECRET_KEY}`,
  "Content-Type": "application/json",
});

const money = (n: number) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

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

    const clientUrl = (process.env.CLIENT_URL || "https://www.thewellnesslab.ae").trim();
    const returnUrl = (result: string) =>
      `${clientUrl}/payment/success?orderId=${order.id}&gateway=tabby&result=${result}`;

    const email = order.guestEmail || order.user?.email || "";
    const name = order.guestName || "Customer";

    const payload = {
      payment: {
        amount: money(order.totalPrice),
        currency: "AED",
        description: `The Wellness Lab order ${order.id}`,
        buyer: {
          phone: order.guestPhone || "",
          email,
          name,
        },
        shipping_address: {
          city: order.city,
          address: order.address,
          zip: order.pincode || "00000",
        },
        order: {
          reference_id: order.id,
          tax_amount: "0.00",
          shipping_amount: money(order.shippingCharge),
          discount_amount: money(order.discount),
          updated_at: order.updatedAt.toISOString(),
          items: order.items.map((it) => ({
            reference_id: it.productId,
            title: it.product?.name || "Item",
            quantity: it.quantity,
            unit_price: money(it.price),
            discount_amount: "0.00",
            category: it.product?.category || "Wellness",
            image_url: it.product?.image || undefined,
          })),
        },
        buyer_history: {
          registered_since: (order.user?.createdAt || order.createdAt).toISOString(),
          loyalty_level: 0,
        },
        order_history: [],
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
      return res.status(400).json({ success: false, error: rejectionMessage(reason) });
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

function rejectionMessage(reason?: string) {
  switch (reason) {
    case "order_amount_too_high":
      return "This purchase is above the amount Tabby can split. Please use a card or Apple Pay.";
    case "order_amount_too_low":
      return "This purchase is below Tabby's minimum amount. Please use a card or Apple Pay.";
    default:
      return "Sorry, Tabby can't approve this purchase. Please use a card or Apple Pay.";
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
