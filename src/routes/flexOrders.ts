import { Router, Request, Response } from "express";
import prisma from "../lib/prisma.js";
import { requireAuthOrApiKey, requireAdminOrApiKey } from "../middleware/auth.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

const router = Router();

// CREATE order
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      guestName,
      guestEmail,
      guestPhone,
      address,
      city,
      pincode,
      items,
      shippingCharge = 0,
      discount = 0,
      couponCode,
      paymentMethod = "cod"
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: "Items are required" });
    }

    if (!guestName || !guestEmail || !address || !city) {
      return res.status(400).json({ success: false, error: "Name, email, address, and city are required" });
    }

    const calculatedSubtotal = items.reduce((sum: number, it: any) => sum + (it.price * it.quantity), 0);
    const calculatedTotalPrice = calculatedSubtotal + Number(shippingCharge) - Number(discount);

    const order = await prisma.flexOrder.create({
      data: {
        guestName,
        guestEmail,
        guestPhone,
        address,
        city,
        pincode: pincode || "00000",
        items: items, // Save items directly as JSON
        subtotal: calculatedSubtotal,
        shippingCharge: Number(shippingCharge),
        discount: Number(discount),
        totalPrice: calculatedTotalPrice,
        couponCode,
        status: "PENDING",
        paymentMethod,
        paymentStatus: "pending"
      }
    });

    res.status(201).json({ success: true, data: order });
  } catch (error) {
    console.error("Error creating flex order:", error);
    res.status(500).json({ success: false, error: "Failed to create order" });
  }
});

// Create Hosted Checkout Session
router.post("/create-checkout-session", async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body;
    const origin = req.headers.origin || "https://www.flexa.thewellnesslab.ae";

    const order = await prisma.flexOrder.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    const items = order.items as any[];
    const line_items = items.map(item => ({
      price_data: {
        currency: 'aed',
        product_data: {
          name: item.name,
          images: [],
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity,
    }));

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
      line_items,
      mode: 'payment',
      success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&orderId=${orderId}`,
      cancel_url: `${origin}/?canceled=true`,
      metadata: {
        orderId,
        isFlexOrder: 'true'
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

// Verify Payment & Fulfill
router.post("/verify-payment", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.body;
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === 'paid') {
      const orderId = session.metadata?.orderId;
      if (orderId) {
        const order = await prisma.flexOrder.update({
          where: { id: orderId },
          data: {
            paymentStatus: 'paid',
            status: 'PROCESSING',
            stripePaymentId: session.payment_intent as string
          }
        });
        
        return res.json({ success: true, order });
      }
    }
    res.json({ success: false, message: "Payment not paid" });
  } catch (err) {
    console.error("Verify Payment Error", err);
    res.status(500).json({ success: false, error: "Verification failed" });
  }
});

// GET all flex orders
router.get("/", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const orders = await prisma.flexOrder.findMany({
      orderBy: { createdAt: "desc" }
    });
    res.json({ success: true, data: orders });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch orders" });
  }
});

// GET stats summary
router.get("/stats/summary", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response) => {
  try {
    const totalOrders = await prisma.flexOrder.count();
    const orders = await prisma.flexOrder.findMany({
      orderBy: { createdAt: 'asc' }
    });

    const totalRevenue = orders.reduce((sum, order) => sum + order.totalPrice, 0);

    const ordersByStatus = {
      PENDING: orders.filter((o) => o.status === "PENDING").length,
      PROCESSING: orders.filter((o) => o.status === "PROCESSING").length,
      SHIPPED: orders.filter((o) => o.status === "SHIPPED").length,
      DELIVERED: orders.filter((o) => o.status === "DELIVERED").length,
      CANCELLED: orders.filter((o) => o.status === "CANCELLED").length,
    };

    res.json({
      success: true,
      data: {
        totalOrders,
        totalRevenue,
        ordersByStatus
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch statistics" });
  }
});

// GET single order
router.get("/:orderId", requireAuthOrApiKey, async (req: Request, res: Response) => {
  try {
    const order = await prisma.flexOrder.findUnique({
      where: { id: req.params.orderId }
    });
    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
    }
    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to fetch order" });
  }
});

// UPDATE order status
router.put("/:orderId", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    const validStatuses = ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Valid status required: ${validStatuses.join(", ")}`,
      });
    }

    const order = await prisma.flexOrder.update({
      where: { id: req.params.orderId },
      data: { status }
    });

    res.json({ success: true, data: order });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update order" });
  }
});

// DELETE order
router.delete("/:orderId", requireAuthOrApiKey, requireAdminOrApiKey, async (req: Request, res: Response) => {
  try {
    await prisma.flexOrder.delete({
      where: { id: req.params.orderId }
    });
    res.json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete order" });
  }
});

export default router;
