import { Router, Request, Response } from "express";
import axios from "axios";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "../lib/email.js";

const router = Router();

const PAYMOB_API_KEY = (process.env.PAYMOB_API_KEY || "").trim();
const PAYMOB_PUBLIC_KEY = (process.env.PAYMOB_PUBLIC_API_KEY || process.env.PAYMOB_PUBLIC_KEY || "").trim();
const PAYMOB_PRIVATE_KEY = (process.env.PAYMOB_PRIVATE_API_KEY || process.env.PAYMOB_SECRET_KEY || "").trim();
const PAYMOB_INTEGRATION_ID = (process.env.PAYMOB_INTEGRATION_ID || "").trim();
const PAYMOB_IFRAME_ID = (process.env.PAYMOB_IFRAME_ID || "").trim();
const PAYMOB_HMAC_SECRET = (process.env.PAYMOB_HMAC_SECRET || "").trim();

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
    const { orderId } = req.body;

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
      if (!PAYMOB_INTEGRATION_ID) {
        return res.status(400).json({
          success: false,
          error: "PAYMOB_INTEGRATION_ID is missing. Please add your Integration ID from Paymob Dashboard (Developers -> Payment Integrations) into backend/.env file as PAYMOB_INTEGRATION_ID.",
        });
      }

      try {
        const integrationIdVal = isNaN(Number(PAYMOB_INTEGRATION_ID))
          ? PAYMOB_INTEGRATION_ID
          : Number(PAYMOB_INTEGRATION_ID);

        const payload: any = {
          amount: amountCents,
          currency: "AED",
          payment_methods: [integrationIdVal],
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

      if (PAYMOB_INTEGRATION_ID && !isNaN(Number(PAYMOB_INTEGRATION_ID))) {
        keyPayload.integration_id = Number(PAYMOB_INTEGRATION_ID);
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
 * Paymob HMAC Verification Helper
 */
function verifyPaymobHmac(data: any, hmacSecret: string): boolean {
  if (!hmacSecret) return true; // If secret is not provided in env, skip blocking

  try {
    const keys = [
      "amount_cents",
      "created_at",
      "currency",
      "error_occured",
      "has_parent_transaction",
      "id",
      "integration_id",
      "is_3d_secure",
      "is_auth",
      "is_capture",
      "is_refunded",
      "is_standalone_payment",
      "order",
      "owner",
      "pending",
      "source_data_pan",
      "source_data_sub_type",
      "source_data_type",
      "success",
    ];

    const obj = data.obj || data;

    const values = keys.map((key) => {
      if (key === "order") return obj.order?.id || obj.order || "";
      if (key === "source_data_pan") return obj.source_data?.pan || "";
      if (key === "source_data_sub_type") return obj.source_data?.sub_type || "";
      if (key === "source_data_type") return obj.source_data?.type || "";
      return obj[key] !== undefined && obj[key] !== null ? String(obj[key]) : "";
    });

    const concatenatedStr = values.join("");
    const calculatedHmac = crypto
      .createHmac("sha512", hmacSecret)
      .update(concatenatedStr)
      .digest("hex");

    const receivedHmac = data.hmac || obj.hmac || "";
    return calculatedHmac.toLowerCase() === receivedHmac.toLowerCase();
  } catch (e) {
    console.error("Paymob HMAC calculation error:", e);
    return false;
  }
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
 * Paymob Webhook / Callback Notification Endpoint
 */
router.all("/callback", async (req: Request, res: Response) => {
  try {
    const payload = req.method === "POST" ? req.body : req.query;
    console.log("Paymob Callback Received:", JSON.stringify(payload).slice(0, 300));

    // Verify HMAC if secret is configured
    if (PAYMOB_HMAC_SECRET && !verifyPaymobHmac(payload, PAYMOB_HMAC_SECRET)) {
      console.error("Invalid Paymob Callback HMAC signature");
      return res.status(400).json({ success: false, error: "Invalid HMAC signature" });
    }

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

    if (isSuccess && merchantOrderId) {
      await fulfillPaymobOrder(merchantOrderId, transactionId, paymobOrderId);
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

    // Attempt fulfillment
    const fulfilledOrder = await fulfillPaymobOrder(targetOrderId, transactionId, paymobOrderId);

    if (fulfilledOrder) {
      return res.json({ success: true, order: fulfilledOrder });
    }

    return res.json({ success: false, message: "Payment status could not be verified as paid" });
  } catch (error: any) {
    console.error("Verify Paymob Payment Error:", error);
    res.status(500).json({ success: false, error: "Payment verification failed" });
  }
});

export default router;
