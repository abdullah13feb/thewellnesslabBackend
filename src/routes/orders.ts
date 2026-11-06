import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";
import { sendOrderConfirmationEmail, sendOrderNotificationEmail } from "../lib/email.js";
import { firstIp } from "../lib/metaCapi.js";
import { priceOrder, toCents } from "../lib/orderPricing.js";
import { verifyReservation } from "../lib/paymob.js";
import { clearCart, ONLINE_PAYMENT_METHODS } from "../lib/cart.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

const router = Router();

// --- Notification Config Routes ---

// Get order email notification configuration
router.get("/notification-config", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    let setting = await prisma.setting.findUnique({
      where: { key: "order_notification_config" },
    });

    if (!setting || !setting.value) {
      // Fallback to lead_notification_config if order_notification_config is not set
      setting = await prisma.setting.findUnique({
        where: { key: "lead_notification_config" },
      });
    }

    let config = { enabled: false, recipientEmails: "", emailSubject: "" };
    if (setting?.value) {
      try {
        config = JSON.parse(setting.value);
      } catch (e) {
        console.error("Error parsing order notification config:", e);
      }
    }

    res.json({ success: true, data: config });
  } catch (error) {
    console.error("Error fetching order notification config:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// Update order email notification configuration
router.post("/notification-config", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { enabled, recipientEmails, emailSubject } = req.body;
    const configValue = JSON.stringify({
      enabled: Boolean(enabled),
      recipientEmails: String(recipientEmails || "").trim(),
      emailSubject: String(emailSubject || "").trim(),
    });

    const setting = await prisma.setting.upsert({
      where: { key: "order_notification_config" },
      update: { value: configValue },
      create: { key: "order_notification_config", value: configValue },
    });

    res.json({ success: true, data: JSON.parse(setting.value) });
  } catch (error) {
    console.error("Error updating order notification config:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// GET all orders (Admin sees all, User sees own)
router.get("/", requireAuthOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    if (req.apiKey) {
      const orders = await prisma.order.findMany({
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
      });

      return res.json({
        success: true,
        data: orders,
        message: `Total orders: ${orders.length}`,
      });
    }

    const userId = req.auth.userId!;

    // Check if admin
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isAdmin = user?.role === 'ADMIN';

    let where: any = {};

    // If NOT admin, force userId filter
    if (!isAdmin) {
      where.userId = userId;
    } else if (req.query.userId) {
      // If Admin and requesting specific user
      where.userId = req.query.userId as string;
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: { include: { product: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json({
      success: true,
      data: orders,
      message: `Total orders: ${orders.length}`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch orders" });
  }
});

// GET order statistics (Admin only)
router.get(
  "/stats/summary",
  requireAuthOrApiKey,
  requireAdminOrApiKey,
  async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
      const totalOrders = await prisma.order.count();
      const orders = await prisma.order.findMany({
        orderBy: { createdAt: 'asc' }
      });

      const totalRevenue = orders.reduce(
        (sum, order) => sum + order.totalPrice,
        0
      );

      const ordersByStatus = {
        PENDING: orders.filter((o) => o.status === "PENDING").length,
        PROCESSING: orders.filter((o) => o.status === "PROCESSING").length,
        SHIPPED: orders.filter((o) => o.status === "SHIPPED").length,
        DELIVERED: orders.filter((o) => o.status === "DELIVERED").length,
        CANCELLED: orders.filter((o) => o.status === "CANCELLED").length,
      };

      // Group by Date for Chart
      const salesMap = new Map<string, { completed: number; pending: number; cancelled: number }>();

      orders.forEach(order => {
        const date = order.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
        const current = salesMap.get(date) || { completed: 0, pending: 0, cancelled: 0 };

        if (['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status)) {
          current.completed += order.totalPrice;
        } else if (order.status === 'PENDING') {
          current.pending += order.totalPrice;
        } else if (order.status === 'CANCELLED') {
          current.cancelled += order.totalPrice;
        }

        salesMap.set(date, current);
      });

      // Convert map to array
      const sortedDates = Array.from(salesMap.keys()).sort();
      const salesData = sortedDates.map(date => {
        const data = salesMap.get(date)!;
        return {
          date,
          completed: data.completed,
          pending: data.pending,
          cancelled: data.cancelled
        };
      });

      // Calculate Growth Metrics (Month over Month)
      const now = new Date();
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();

      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

      const currentMonthOrders = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
      });

      const lastMonthOrders = orders.filter(o => {
        const d = new Date(o.createdAt);
        return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear;
      });

      // Revenue Growth
      const currentMonthRevenue = currentMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0);
      const lastMonthRevenue = lastMonthOrders.reduce((sum, o) => sum + o.totalPrice, 0);

      let revenueGrowth = 0;
      if (lastMonthRevenue > 0) {
        revenueGrowth = ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
      } else if (currentMonthRevenue > 0) {
        revenueGrowth = 100; // 100% growth if prev month was 0
      }

      // Order Count Growth
      let ordersGrowth = 0;
      const currentCount = currentMonthOrders.length;
      const lastCount = lastMonthOrders.length;

      if (lastCount > 0) {
        ordersGrowth = ((currentCount - lastCount) / lastCount) * 100;
      } else if (currentCount > 0) {
        ordersGrowth = 100;
      }

      const stats = {
        totalOrders,
        totalRevenue,
        ordersByStatus,
        salesData,
        growth: {
          revenue: revenueGrowth,
          orders: ordersGrowth
        }
      };

      res.json({ success: true, data: stats });
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .json({ success: false, error: "Failed to fetch statistics" });
    }
  }
);

// GET single order
router.get("/:orderId", requireAuthOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }

    if (req.apiKey) {
      return res.json({ success: true, data: order });
    }

    // Check ownership or admin
    if (order.userId !== req.auth.userId) {
      const user = await prisma.user.findUnique({ where: { id: req.auth.userId! } });
      if (user?.role !== 'ADMIN') {
        return res.status(403).json({ success: false, error: "Unauthorized" });
      }
    }

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch order" });
  }
});

// Create Hosted Checkout Session
router.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } } }
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const line_items = order.items.map(item => ({
      price_data: {
        currency: 'aed',
        product_data: {
          name: item.product.name,
          images: item.product.image ? [item.product.image] : [],
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

    // Add Shipping if > 0
    if (order.shippingCharge > 0) {
      line_items.push({
        price_data: {
          currency: 'aed',
          product_data: {
            name: 'Shipping Charge',
            images: [],
          },
          unit_amount: Math.round(order.shippingCharge * 100),
        },
        quantity: 1,
      });
    }

    let sessionConfig: any = {
      line_items: line_items,
      mode: 'payment',
      success_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/payment/success?session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`,
      cancel_url: `${process.env.CLIENT_URL || 'http://localhost:3000'}/checkout?canceled=true`,
      metadata: {
        orderId: orderId
      },
      customer_email: order.guestEmail || undefined,
    };

    if (order.discount > 0) {
      try {
        const coupon = await stripe.coupons.create({
          amount_off: Math.round(order.discount * 100),
          currency: 'aed',
          duration: 'once',
          name: order.couponCode || 'Discount'
        });
        sessionConfig.discounts = [{ coupon: coupon.id }];
      } catch (e) {
        console.error("Failed to create coupon or discount logic error", e);
      }
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Checkout Error:", error);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// Marks an order paid via Stripe and sends the confirmation + admin emails (only the first time).
async function fulfillStripeOrder(orderId: string, paymentIntentId: string) {
  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { include: { product: true } } },
  });
  if (!existing) return null;
  if (existing.paymentStatus === "paid") return existing;

  const order = await prisma.order.update({
    where: { id: orderId },
    data: { paymentStatus: "paid", status: "PROCESSING", stripePaymentId: paymentIntentId },
    include: { items: { include: { product: true } } },
  });

  try {
    let userEmail = order.guestEmail;
    if (!userEmail && order.userId) {
      const user = await prisma.user.findUnique({ where: { id: order.userId } });
      userEmail = user?.email || null;
    }
    if (userEmail) await sendOrderConfirmationEmail({ ...order, userEmail });
  } catch (emailErr) {
    console.error("Failed to send order confirmation email:", emailErr);
  }
  try {
    await sendOrderNotificationEmail(order);
  } catch (err) {
    console.error("Failed to send order notification email on Stripe payment:", err);
  }
  return order;
}

// Embedded Stripe card form: create (or reuse) a PaymentIntent for an unpaid order.
router.post("/create-payment-intent", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: String(orderId || "") } });
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    if (order.paymentStatus === "paid") {
      return res.status(400).json({ success: false, error: "This order is already paid." });
    }

    const amount = toCents(order.totalPrice);

    if (order.stripePaymentId?.startsWith("pi_")) {
      const prev = await stripe.paymentIntents.retrieve(order.stripePaymentId);
      if (prev.status !== "canceled" && prev.status !== "succeeded" && prev.amount === amount) {
        return res.json({ success: true, clientSecret: prev.client_secret });
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: "aed",
      payment_method_types: ["card"],
      receipt_email: order.guestEmail || undefined,
      metadata: { orderId: order.id },
    });

    await prisma.order.update({ where: { id: order.id }, data: { stripePaymentId: intent.id } });

    res.json({ success: true, clientSecret: intent.client_secret });
  } catch (error: any) {
    console.error("Stripe PaymentIntent Error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to start card payment" });
  }
});

// Embedded Stripe card form: confirm the PaymentIntent succeeded and fulfil the order.
router.post("/verify-payment-intent", async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    if (!paymentIntentId) return res.status(400).json({ success: false, error: "Missing payment id" });

    const intent = await stripe.paymentIntents.retrieve(String(paymentIntentId));
    const orderId = intent.metadata?.orderId;
    if (intent.status !== "succeeded" || !orderId) {
      return res.json({ success: false, message: "Payment not completed" });
    }

    const current = await prisma.order.findUnique({ where: { id: orderId } });
    if (!current || toCents(current.totalPrice) !== intent.amount) {
      console.error(`Stripe amount mismatch for order ${orderId}: intent ${intent.amount}`);
      return res.json({ success: false, message: "Payment amount does not match the order" });
    }

    const order = await fulfillStripeOrder(orderId, intent.id);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, order });
  } catch (err) {
    console.error("Verify PaymentIntent Error", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// Verify Payment & Fulfill
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const orderId = session.metadata?.orderId;
      if (orderId) {
        const order = await prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: 'paid',
            status: 'PROCESSING',
            stripePaymentId: session.payment_intent as string
          },
          include: { items: { include: { product: true } } }
        });
        // Send Confirmation Email for Online Payment Success
        try {
          let userEmail = order.guestEmail;
          if (!userEmail && order.userId) {
            const user = await prisma.user.findUnique({ where: { id: order.userId } });
            userEmail = user?.email || null;
          }

          if (userEmail) {
            await sendOrderConfirmationEmail({
              ...order,
              userEmail
            });
          }
        } catch (emailErr) {
          console.error("Failed to send order confirmation email:", emailErr);
        }

        // Send Admin Order Notification Alert
        try {
          await sendOrderNotificationEmail(order);
        } catch (err) {
          console.error("Failed to send order notification email on verify-payment:", err);
        }

        return res.json({ success: true, order });
      }
    }
    res.json({ success: false, message: "Payment not paid" });
  } catch (err) {
    console.error("Verify Payment Error", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// CREATE order (Guest or User)
router.post("/", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { items: requestedItems, guestName, guestEmail, guestPhone, address, city, pincode, paymentMethod, stripePaymentId } = req.body;

    // Check for auth manually since we removed the middleware to support guests
    // Note: This requires Clerk middleware to be loose or we just check req.auth if available.
    // Assuming Clerk middleware populates req.auth if present but doesn't block if not?
    // If strict requireAuth was used, we need to adapt.
    // Let's assume we use loose auth or check headers.
    // Actually, `ClerkExpressRequireAuth` enforces auth. We should use `ClerkExpressWithAuth` for loose mode if available, 
    // OR just use a different logic. 
    // Since I can't easily change the global middleware import quickly, 
    // I will assume for this route specifically we might need to handle "if user is logged in" on frontend by sending token.
    // If guest, no token.
    // So this route should NOT use `requireAuth`.

    const userId = req.auth?.userId;

    const priced = await priceOrder(requestedItems, req.body.couponCode);
    if (!priced.ok) {
      return res.status(priced.status).json({ success: false, error: priced.error });
    }
    const { items, subtotal, shippingCharge, discount } = priced;
    const validatedCouponCode = priced.couponCode;

    // Validation
    if (!userId) {
      // Guest validation
      if (!guestName || !guestEmail || !address || !city || !pincode) {
        return res.status(400).json({
          success: false,
          error: "Guest details (Name, Email, Address, City, Pincode) are required for guest checkout",
        });
      }
    } else {
      if (!address || !city || !pincode) {
        return res.status(400).json({
          success: false,
          error: "Shipping address is required",
        });
      }
    }

    const finalTotalPrice = priced.total;

    // Embedded Paymob card form: the order id and amount were reserved when the form loaded.
    const reservation = req.body.paymobReservation;
    let reservedId: string | undefined;
    if (reservation) {
      const amountCents = Number(reservation.amountCents);
      const valid = verifyReservation(
        String(reservation.reference || ""),
        amountCents,
        String(reservation.clientSecret || ""),
        String(reservation.signature || "")
      );
      if (!valid) {
        return res.status(400).json({ success: false, error: "Payment session expired. Please refresh the page and try again." });
      }
      if (toCents(finalTotalPrice) !== amountCents) {
        return res.status(409).json({
          success: false,
          error: "Your order total changed. Please review it and pay again.",
          code: "AMOUNT_CHANGED",
        } as any);
      }
      reservedId = String(reservation.reference);
      // A retry after a declined card reuses the order created on the first attempt.
      const existing = await prisma.order.findUnique({
        where: { id: reservedId },
        include: { items: { include: { product: true } } },
      });
      if (existing) {
        if (existing.paymentStatus === "paid") {
          return res.status(400).json({ success: false, error: "This order is already paid." });
        }
        return res.status(200).json({ success: true, data: existing, message: "Order already created" });
      }
    }

    const attr = req.body.attribution || {};
    const clip = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

    const order = await prisma.order.create({
      data: {
        ...(reservedId ? { id: reservedId } : {}),
        userId: userId || undefined,
        guestName: guestName || null,
        guestEmail: guestEmail || null,
        guestPhone: guestPhone || null,
        address,
        city,
        pincode,
        subtotal,
        shippingCharge,
        discount,
        totalPrice: finalTotalPrice,
        couponCode: validatedCouponCode,

        status: "PENDING",
        paymentMethod: paymentMethod || "cod",
        paymentStatus: "pending",
        stripePaymentId: stripePaymentId || null,
        fbp: clip(attr.fbp),
        fbc: clip(attr.fbc),
        fbclid: clip(attr.fbclid),
        utmSource: clip(attr.utmSource),
        utmMedium: clip(attr.utmMedium),
        utmCampaign: clip(attr.utmCampaign),
        utmContent: clip(attr.utmContent),
        utmTerm: clip(attr.utmTerm),
        clientIp: clip(firstIp(req.headers["x-forwarded-for"]) || req.ip || req.socket?.remoteAddress, 64),
        clientUserAgent: clip(req.headers["user-agent"]),
        items: {
          create: items.map(
            (item: { productId: string; quantity: number; price: number }) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
            })
          ),
        },
      },
      include: { items: { include: { product: true } } },
    });

    // Online payments keep the cart until the payment succeeds (see lib/cart.ts). Only storefronts that
    // empty the cart on the success page send keepCartUntilPaid; older ones still expect it emptied here.
    const keepCart = req.body.keepCartUntilPaid === true && ONLINE_PAYMENT_METHODS.includes(paymentMethod);
    if (!keepCart) {
      if (userId) await clearCart({ userId });
      else if (req.body.guestId) await clearCart({ guestId: String(req.body.guestId) });
    }

    // Send Confirmation Email
    // check if COD, send email immediately. Online payments wait for verification.
    if (!ONLINE_PAYMENT_METHODS.includes(paymentMethod)) {
      try {
        let userEmail = order.guestEmail;
        if (!userEmail && userId) {
          const user = await prisma.user.findUnique({ where: { id: userId } });
          userEmail = user?.email || null;
        }

        if (userEmail) {
          await sendOrderConfirmationEmail({
            ...order,
            userEmail
          });
        }
      } catch (emailErr) {
        console.error("Failed to send order confirmation email:", emailErr);
      }
    }

    // Send Admin Order Notification Alert (awaited for AWS Lambda serverless execution)
    try {
      await sendOrderNotificationEmail(order);
    } catch (err) {
      console.error("Failed to send order notification email on order create:", err);
    }

    res.status(201).json({
      success: true,
      data: order,
      message: "Order created successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: "Failed to create order" });
  }
});

// UPDATE order status (Admin only)
router.put("/:orderId", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { status } = req.body;

    const validStatuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${validStatuses.join(", ")}`,
      });
    }

    const order = await prisma.order.update({
      where: { id: req.params.orderId },
      data: { status },
      include: { items: { include: { product: true } } },
    });

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update order" });
  }
});

// DELETE order (Admin only)
router.delete(
  "/:orderId",
  requireAuthOrApiKey,
  requireAdminOrApiKey,
  async (req: Request, res: Response<ApiResponse<null>>) => {
    try {
      await prisma.order.delete({
        where: { id: req.params.orderId },
      });

      res.json({
        success: true,
        message: "Order deleted successfully",
      });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to delete order" });
    }
  }
);

export default router;
