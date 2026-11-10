import { Router, Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "../lib/email.js";
import { sendOrderNotificationWhatsapp } from "../lib/whatsappNotify.js";
import { sendMetaEvent, userData, contentId } from "../lib/metaCapi.js";
import { priceOrder, toCents } from "../lib/orderPricing.js";
import { checkPaymobTransaction, signReservation } from "../lib/paymob.js";
import { clearCart } from "../lib/cart.js";

const router = Router();

const PAYMOB_API_KEY = (process.env.PAYMOB_API_KEY || "").trim();
const PAYMOB_PUBLIC_KEY = (process.env.PAYMOB_PUBLIC_API_KEY || process.env.PAYMOB_PUBLIC_KEY || "").trim();
const PAYMOB_PRIVATE_KEY = (process.env.PAYMOB_PRIVATE_API_KEY || process.env.PAYMOB_SECRET_KEY || "").trim();
const PAYMOB_INTEGRATION_ID = (process.env.PAYMOB_INTEGRATION_ID || "").trim();
const PAYMOB_IFRAME_ID = (process.env.PAYMOB_IFRAME_ID || "").trim();
const PAYMOB_CARD_INTEGRATION_ID = (process.env.PAYMOB_CARD_INTEGRATION_ID || "").trim();
const PAYMOB_APPLE_PAY_INTEGRATION_ID = (process.env.PAYMOB_APPLE_PAY_INTEGRATION_ID || "").trim();

/**
 * Integration IDs to offer for the method the shopper picked at checkout.
 * "apple_pay" opens Paymob's page with only Apple Pay; "card" offers cards (and Google Pay).
 * Falls back to PAYMOB_INTEGRATION_ID (all methods) when the specific ID is not configured.
 */
function integrationIdsFor(method?: string): string {
  if (method === "apple_pay" && PAYMOB_APPLE_PAY_INTEGRATION_ID) return PAYMOB_APPLE_PAY_INTEGRATION_ID;
  if (method === "card" && PAYMOB_CARD_INTEGRATION_ID) return PAYMOB_CARD_INTEGRATION_ID;
  return PAYMOB_INTEGRATION_ID;
}

/**
 * Helper: Parse Full Name into First Name & Last Name
 */
function parseName(fullName?: string | null) {
  const clean = (fullName || "").trim();
  if (!clean) return { firstName: "Customer", lastName: "Guest" };
  const parts = clean.split(" ");
  const firstName = parts[0] || "Customer";
  const lastName = parts.slice(1).join(" ") || "Guest";
  return { firstName, lastName };
}

/**
 * Create Paymob Checkout Session / URL for AED Currency
 */
router.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    const { orderId, method } = req.body;
    const integrationIdList = integrationIdsFor(typeof method === "string" ? method : undefined);

    if (!orderId) {
      return res.status(400).json({ success: false, error: "Order ID is required" });
    }

    // Try standard Order first
    let order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } },
    });

    let isFlexOrder = false;
    let flexOrder: any = null;

    if (!order) {
      flexOrder = await prisma.flexOrder.findUnique({
        where: { id: orderId },
      });
      if (!flexOrder) {
        return res.status(404).json({ success: false, error: "Order not found" });
      }
      isFlexOrder = true;
    }

    const targetOrder = isFlexOrder ? flexOrder : order;
    const clientUrl = process.env.CLIENT_URL || "https://www.thewellnesslab.ae";
    const amountCents = Math.round((targetOrder.totalPrice || 0) * 100);

    const { firstName, lastName } = parseName(targetOrder.guestName);
    const email = targetOrder.guestEmail || "customer@thewellnesslab.ae";
    const phone = targetOrder.guestPhone || "+971500000000";
    const city = targetOrder.city || "Dubai";
    const address = targetOrder.address || "UAE";
    const pincode = targetOrder.pincode || "00000";

    const billingData = {
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone_number: phone,
      apartment: "NA",
      floor: "NA",
      street: address,
      building: "NA",
      shipping_method: "PKG",
      postal_code: pincode,
      city: city,
      country: "AE",
      state: city,
    };

    let checkoutUrl = "";
    let paymobOrderId = "";

    // --- Paymob UAE Intention API (Unified Checkout) ---
    if (PAYMOB_PRIVATE_KEY) {
      if (!integrationIdList) {
        return res.status(400).json({
          success: false,
          error: "PAYMOB_INTEGRATION_ID is missing. Please add your Integration ID from Paymob Dashboard (Developers -> Payment Integrations) into backend/.env file as PAYMOB_INTEGRATION_ID.",
        });
      }

      try {
        const rawIds = integrationIdList.split(",").map((id) => id.trim()).filter(Boolean);
        const integrationIds = rawIds.map((id) => (isNaN(Number(id)) ? id : Number(id)));

        const payload: any = {
          amount: amountCents,
          currency: "AED",
          payment_methods: integrationIds,
          billing_data: billingData,
          customer: {
            first_name: firstName,
            last_name: lastName,
            email: email,
            phone_number: phone,
          },
          special_reference: orderId,
          extras: {
            merchant_order_id: orderId,
            is_flex_order: isFlexOrder ? "true" : "false",
          },
          redirection_url: `${clientUrl}/payment/success?orderId=${orderId}&gateway=paymob`,
        };

        const intentionRes = await axios.post(
          "https://uae.paymob.com/v1/intention/",
          payload,
          {
            headers: {
              Authorization: `Token ${PAYMOB_PRIVATE_KEY}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (intentionRes && intentionRes.data && (intentionRes.data.client_secret || intentionRes.data.cs)) {
          const clientSecret = intentionRes.data.client_secret || intentionRes.data.cs;
          paymobOrderId = String(intentionRes.data.id || intentionRes.data.intention_id || "");

          if (PAYMOB_PUBLIC_KEY) {
            checkoutUrl = `https://uae.paymob.com/unifiedcheckout/?publicKey=${PAYMOB_PUBLIC_KEY}&clientSecret=${clientSecret}`;
          } else {
            checkoutUrl = `https://accept.paymob.com/standalone/p/${clientSecret}`;
          }
        }
      } catch (err: any) {
        console.error("Paymob UAE Intention API Error:", err?.response?.data || err.message);
        return res.status(400).json({
          success: false,
          error: err?.response?.data?.detail || err?.response?.data?.message || err?.response?.data?.payment_methods?.[0] || "Failed to create Paymob payment session",
          details: err?.response?.data
        });
      }
    }

    // --- APPROACH 2: Fallback to Paymob 3-Step Accept API ---
    if (!checkoutUrl && PAYMOB_API_KEY) {
      // Step 1: Get Auth Token
      const authRes = await axios.post("https://accept.paymob.com/api/auth/tokens", {
        api_key: PAYMOB_API_KEY,
      });

      const authToken = authRes.data.token;

      // Step 2: Register Order
      const items = isFlexOrder
        ? (flexOrder.items as any[]).map((it: any) => ({
            name: String(it.name || "Item"),
            amount_cents: Math.round(Number(it.price || 0) * 100),
            description: String(it.name || "Item"),
            quantity: Number(it.quantity || 1),
          }))
        : (order?.items || []).map((it: any) => ({
            name: String(it.product?.name || "Item"),
            amount_cents: Math.round(Number(it.price || 0) * 100),
            description: String(it.product?.name || "Item"),
            quantity: Number(it.quantity || 1),
          }));

      const orderRes = await axios.post("https://accept.paymob.com/api/ecommerce/orders", {
        auth_token: authToken,
        delivery_needed: "false",
        amount_cents: amountCents,
        currency: "AED",
        merchant_order_id: `${orderId}_${Date.now()}`,
        items: items,
      });

      paymobOrderId = String(orderRes.data.id);

      // Step 3: Payment Key Request
      const keyPayload: any = {
        auth_token: authToken,
        amount_cents: amountCents,
        expiration: 3600,
        order_id: paymobOrderId,
        billing_data: billingData,
        currency: "AED",
      };

      const primaryId = (integrationIdList || "").split(",")[0].trim();
      if (primaryId && !isNaN(Number(primaryId))) {
        keyPayload.integration_id = Number(primaryId);
      }

      const keyRes = await axios.post("https://accept.paymob.com/api/acceptance/payment_keys", keyPayload);
      const paymentToken = keyRes.data.token;

      if (PAYMOB_IFRAME_ID) {
        checkoutUrl = `https://accept.paymob.com/api/acceptance/iframes/${PAYMOB_IFRAME_ID}?payment_token=${paymentToken}`;
      } else {
        checkoutUrl = `https://accept.paymob.com/standalone/p/${paymentToken}`;
      }
    }

    if (!checkoutUrl) {
      return res.status(500).json({
        success: false,
        error: "Failed to generate Paymob checkout URL. Please check Paymob API credentials.",
      });
    }

    // Save paymobOrderId to order
    if (paymobOrderId) {
      if (isFlexOrder) {
        await prisma.flexOrder.update({
          where: { id: orderId },
          data: { paymobOrderId },
        });
      } else {
        await prisma.order.update({
          where: { id: orderId },
          data: { paymobOrderId },
        });
      }
    }

    res.json({ success: true, url: checkoutUrl, paymobOrderId });
  } catch (error: any) {
    console.error("Paymob Checkout Error:", error?.response?.data || error.message || error);
    res.status(500).json({
      success: false,
      error: error?.response?.data?.message || "Failed to create Paymob checkout session",
    });
  }
});

/**
 * Intention for the card / Apple Pay form embedded in the checkout page (Paymob Pixel).
 * The order does not exist yet: an order id is reserved and the amount is priced server-side.
 * The order is created with that id right before the payment runs (see POST /api/orders).
 */
router.post("/prepare-embedded", async (req: Request, res: Response) => {
  try {
    if (!PAYMOB_PRIVATE_KEY || !PAYMOB_PUBLIC_KEY) {
      return res.status(500).json({ success: false, error: "Paymob is not configured" });
    }

    const { items, couponCode, email } = req.body;
    const priced = await priceOrder(items, couponCode);
    if (!priced.ok) return res.status(priced.status).json({ success: false, error: priced.error });

    const amountCents = toCents(priced.total);
    const reference = `c${crypto.randomBytes(12).toString("hex")}`;
    const clientUrl = process.env.CLIENT_URL || "https://www.thewellnesslab.ae";
    const apiHost = req.get("host");

    const ids = [PAYMOB_CARD_INTEGRATION_ID || PAYMOB_INTEGRATION_ID, PAYMOB_APPLE_PAY_INTEGRATION_ID]
      .join(",")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .filter((id, i, all) => all.indexOf(id) === i)
      .map((id) => (isNaN(Number(id)) ? id : Number(id)));

    const contactEmail = typeof email === "string" && /^\S+@\S+\.\S+$/.test(email) ? email : "customer@thewellnesslab.ae";

    const { data } = await axios.post(
      "https://uae.paymob.com/v1/intention/",
      {
        amount: amountCents,
        currency: "AED",
        payment_methods: ids,
        billing_data: {
          first_name: "Customer",
          last_name: "TheWellnessLab",
          email: contactEmail,
          phone_number: "+971500000000",
          apartment: "NA",
          floor: "NA",
          street: "NA",
          building: "NA",
          shipping_method: "PKG",
          postal_code: "00000",
          city: "Dubai",
          country: "AE",
          state: "Dubai",
        },
        special_reference: reference,
        extras: { merchant_order_id: reference, is_flex_order: "false" },
        redirection_url: `${clientUrl}/payment/success?orderId=${reference}&gateway=paymob`,
        ...(apiHost ? { notification_url: `https://${apiHost}/api/paymob/callback` } : {}),
      },
      { headers: { Authorization: `Token ${PAYMOB_PRIVATE_KEY}`, "Content-Type": "application/json" } }
    );

    const clientSecret = data?.client_secret || data?.cs;
    if (!clientSecret) {
      return res.status(502).json({ success: false, error: "Could not start card payment" });
    }

    res.json({
      success: true,
      publicKey: PAYMOB_PUBLIC_KEY,
      clientSecret,
      reference,
      amountCents,
      signature: signReservation(reference, amountCents, clientSecret),
      applePayInline: (process.env.PAYMOB_PIXEL_APPLE_PAY || "").trim() === "true",
    });
  } catch (error: any) {
    console.error("Paymob prepare-embedded error:", error?.response?.data || error.message || error);
    res.status(500).json({ success: false, error: "Could not load the card form. Please try again." });
  }
});

/** Amount Paymob must have charged for an order (standard or flex). */
async function payableAmountCents(orderId: string): Promise<number | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { totalPrice: true } });
  if (order) return toCents(order.totalPrice);
  const flex = await prisma.flexOrder.findUnique({ where: { id: orderId }, select: { totalPrice: true } });
  return flex ? toCents(flex.totalPrice) : null;
}

/**
 * Helper to fulfill order upon successful Paymob payment
 */
async function fulfillPaymobOrder(orderId: string, transactionId?: string, paymobOrderId?: string) {
  let order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });

  if (order) {
    if (order.paymentStatus !== "paid") {
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          paymentStatus: "paid",
          status: "PROCESSING",
          paymobTransactionId: transactionId || order.paymobTransactionId || null,
          paymobOrderId: paymobOrderId || order.paymobOrderId || null,
        },
        include: { items: { include: { product: true } } },
      });

      // The cart is kept until payment succeeds; the success page clears guest carts in the browser.
      if (updatedOrder.userId) {
        try {
          await clearCart({ userId: updatedOrder.userId });
        } catch (err) {
          console.error("Failed to clear cart after Paymob payment:", err);
        }
      }

      // Send Order Confirmation Email
      try {
        let userEmail = updatedOrder.guestEmail;
        if (!userEmail && updatedOrder.userId) {
          const user = await prisma.user.findUnique({ where: { id: updatedOrder.userId } });
          userEmail = user?.email || null;
        }

        if (userEmail) {
          await sendOrderConfirmationEmail({
            ...updatedOrder,
            userEmail,
          });
        }
      } catch (emailErr) {
        console.error("Failed to send Paymob order confirmation email:", emailErr);
      }

      // Send Admin Notification Email
      try {
        await sendOrderNotificationEmail(updatedOrder);
      } catch (err) {
        console.error("Failed to send admin notification email for Paymob order:", err);
      }
      await sendOrderNotificationWhatsapp(updatedOrder);

      return updatedOrder;
    }
    return order;
  }

  // Check FlexOrder
  let flexOrder = await prisma.flexOrder.findUnique({
    where: { id: orderId },
  });

  if (flexOrder) {
    if (flexOrder.paymentStatus !== "paid") {
      const updatedFlexOrder = await prisma.flexOrder.update({
        where: { id: orderId },
        data: {
          paymentStatus: "paid",
          status: "PROCESSING",
          paymobTransactionId: transactionId || flexOrder.paymobTransactionId || null,
          paymobOrderId: paymobOrderId || flexOrder.paymobOrderId || null,
        },
      });
      return updatedFlexOrder;
    }
    return flexOrder;
  }

  return null;
}

/**
 * Meta Conversions API Purchase for a paid order (Order or FlexOrder), sent once per order.
 * event_id is the order id, the same eventID the browser Purchase uses on /payment/success,
 * so Meta counts the sale once.
 */
export async function sendMetaPurchase(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } }, user: true },
  });
  const flex = order ? null : await prisma.flexOrder.findUnique({ where: { id: orderId } });
  const target: any = order || flex;
  if (!target || target.paymentStatus !== "paid" || target.metaPurchaseSentAt) return;

  // Claim the order first, so a repeated webhook cannot send a second Purchase.
  const claim = order
    ? await prisma.order.updateMany({ where: { id: orderId, metaPurchaseSentAt: null }, data: { metaPurchaseSentAt: new Date() } })
    : await prisma.flexOrder.updateMany({ where: { id: orderId, metaPurchaseSentAt: null }, data: { metaPurchaseSentAt: new Date() } });
  if (claim.count === 0) return;

  const items: { id: string; quantity: number; price: number }[] = order
    ? order.items.map((it) => ({ id: contentId(it.product?.slug || it.productId), quantity: it.quantity, price: it.price }))
    : ((flex?.items as any[]) || []).map((it: any) => ({
        id: contentId(it.name || "item"),
        quantity: Number(it.quantity) || 1,
        price: Number(it.price) || 0,
      }));

  const user: Record<string, unknown> = userData({
    email: target.guestEmail || order?.user?.email,
    phone: target.guestPhone,
    name: target.guestName,
    city: target.city,
  });
  if (order?.fbp) user.fbp = order.fbp;
  if (order?.fbc) user.fbc = order.fbc;
  if (order?.clientIp) user.client_ip_address = order.clientIp;
  if (order?.clientUserAgent) user.client_user_agent = order.clientUserAgent;

  const clientUrl = process.env.CLIENT_URL || "https://www.thewellnesslab.ae";
  const ok = await sendMetaEvent({
    event_name: "Purchase",
    event_id: orderId,
    action_source: "website",
    event_source_url: `${clientUrl}/payment/success`,
    user_data: user,
    custom_data: {
      currency: "AED",
      value: Number(target.totalPrice) || 0,
      content_type: "product",
      content_ids: items.map((it) => it.id),
      contents: items.map((it) => ({ id: it.id, quantity: it.quantity, item_price: it.price })),
      num_items: items.reduce((n, it) => n + it.quantity, 0),
      order_id: orderId,
    },
  });

  // Not accepted: release the claim so the next webhook retry can send it.
  if (!ok) {
    if (order) await prisma.order.update({ where: { id: orderId }, data: { metaPurchaseSentAt: null } });
    else await prisma.flexOrder.update({ where: { id: orderId }, data: { metaPurchaseSentAt: null } });
  }
}

/**
 * Paymob Webhook / Callback Notification Endpoint
 */
router.all("/callback", async (req: Request, res: Response) => {
  try {
    const payload = req.method === "POST" ? req.body : req.query;
    console.log("Paymob Callback Received:", JSON.stringify(payload).slice(0, 300));

    const obj = payload.obj || payload;
    const isSuccess =
      obj.success === true ||
      obj.success === "true" ||
      payload.success === "true" ||
      payload.success === true;

    const transactionId = String(obj.id || payload.id || payload.transaction_id || "");
    const paymobOrderId = String(obj.order?.id || obj.order || payload.order || payload.paymob_order_id || "");
    
    let merchantOrderId = String(
      obj.merchant_order_id ||
        obj.order?.merchant_order_id ||
        payload.merchant_order_id ||
        obj.extras?.merchant_order_id ||
        payload.special_reference ||
        ""
    );

    // If merchant_order_id has timestamp suffix (e.g. orderId_170000000), strip it
    if (merchantOrderId.includes("_")) {
      merchantOrderId = merchantOrderId.split("_")[0];
    }

    // The body is not trusted: the transaction is looked up on Paymob before fulfilling.
    if (isSuccess && merchantOrderId && transactionId) {
      const expected = await payableAmountCents(merchantOrderId);
      if (expected !== null) {
        const check = await checkPaymobTransaction(transactionId, merchantOrderId, expected);
        if (check.paid) {
          await fulfillPaymobOrder(merchantOrderId, transactionId, check.paymobOrderId || paymobOrderId);
          try {
            await sendMetaPurchase(merchantOrderId);
          } catch (metaErr) {
            console.error("Meta CAPI Purchase error:", metaErr);
          }
        } else {
          console.warn("Paymob callback not fulfilled:", merchantOrderId, check.reason);
        }
      }
    }

    // Return success to Paymob webhook
    return res.status(200).json({ success: true, message: "Callback processed" });
  } catch (error: any) {
    console.error("Paymob Webhook Error:", error);
    return res.status(500).json({ success: false, error: "Webhook processing error" });
  }
});

/**
 * Verify Paymob Payment Status from Frontend Redirect
 */
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { orderId, transactionId, paymobOrderId } = req.body;

    if (!orderId && !paymobOrderId && !transactionId) {
      return res.status(400).json({ success: false, error: "Order ID or Transaction ID is required" });
    }

    let targetOrderId = orderId;

    // Search by paymobOrderId if targetOrderId is missing
    if (!targetOrderId && paymobOrderId) {
      const orderMatch = await prisma.order.findFirst({
        where: { paymobOrderId: String(paymobOrderId) },
      });
      if (orderMatch) {
        targetOrderId = orderMatch.id;
      } else {
        const flexMatch = await prisma.flexOrder.findFirst({
          where: { paymobOrderId: String(paymobOrderId) },
        });
        if (flexMatch) targetOrderId = flexMatch.id;
      }
    }

    if (!targetOrderId) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Check if already fulfilled
    let existingOrder = await prisma.order.findUnique({
      where: { id: targetOrderId },
      include: { items: { include: { product: true } } },
    });

    if (existingOrder && existingOrder.paymentStatus === "paid") {
      return res.json({ success: true, order: existingOrder });
    }

    let existingFlex = await prisma.flexOrder.findUnique({
      where: { id: targetOrderId },
    });

    if (existingFlex && existingFlex.paymentStatus === "paid") {
      return res.json({ success: true, order: existingFlex });
    }

    const expected = existingOrder
      ? toCents(existingOrder.totalPrice)
      : existingFlex
        ? toCents(existingFlex.totalPrice)
        : null;
    if (expected === null) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    // Never mark paid from the redirect alone: confirm the transaction with Paymob.
    let check;
    try {
      check = await checkPaymobTransaction(String(transactionId || ""), targetOrderId, expected);
    } catch (err: any) {
      console.error("Paymob transaction lookup failed:", err?.response?.data || err.message);
      return res.json({ success: false, message: "Payment could not be confirmed yet" });
    }
    if (!check.paid) {
      console.warn("Paymob verify not paid:", targetOrderId, check.reason);
      return res.json({ success: false, message: "Payment status could not be verified as paid" });
    }

    const fulfilledOrder = await fulfillPaymobOrder(targetOrderId, String(transactionId), check.paymobOrderId || paymobOrderId);
    try {
      await sendMetaPurchase(targetOrderId);
    } catch (metaErr) {
      console.error("Meta CAPI Purchase error:", metaErr);
    }

    return res.json({ success: true, order: fulfilledOrder });
  } catch (error: any) {
    console.error("Verify Paymob Payment Error:", error);
    res.status(500).json({ success: false, error: "Payment verification failed" });
  }
});

export default router;
