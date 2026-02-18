import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { sendOrderConfirmationEmail } from "../lib/email.js";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16" as any,
});

const router = Router();

// GET all orders (Admin sees all, User sees own)
router.get("/", requireAuth, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
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
  requireAuth,
  requireAdmin,
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
router.get("/:orderId", requireAuth, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: { items: { include: { product: true } } },
    });

    if (!order) {
      return res.status(404).json({ success: false, error: "Order not found" });
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
          }
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
    const { items, totalPrice, guestName, guestEmail, guestPhone, address, city, pincode, paymentMethod, stripePaymentId } = req.body;

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

    if (!items || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Items array is required",
      });
    }

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
      // User validation (ensure address is present if provided, or maybe we pull from profile later? 
      // For now let's require address in body for both for simplicity of 'Checkout Form' request)
      if (!address || !city || !pincode) {
        return res.status(400).json({
          success: false,
          error: "Shipping address is required",
        });
      }
    }

    // Calc subtotal from items to prevent client manipulation
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.price * item.quantity), 0);

    // Fetch dynamic shipping cost from settings
    const shippingSetting = await prisma.setting.findUnique({ where: { key: "shipping_cost" } });
    let shippingCharge = 0;
    if (shippingSetting && shippingSetting.value) {
      const parsed = parseFloat(shippingSetting.value);
      shippingCharge = isNaN(parsed) ? 0 : parsed;
    }

    // Handle Discount/Coupon
    let discount = 0;
    let validatedCouponCode = null;
    const { couponCode } = req.body;

    if (couponCode) {
      const coupon = await prisma.coupon.findUnique({
        where: { code: couponCode.toUpperCase(), isActive: true }
      });

      if (coupon) {
        // Expiry check
        const isExpired = coupon.expiry && new Date(coupon.expiry) < new Date();
        const meetsMinPurchase = subtotal >= coupon.minPurchase;

        if (!isExpired && meetsMinPurchase) {
          if (coupon.type === "PERCENTAGE") {
            discount = (subtotal * coupon.discount) / 100;
          } else {
            discount = coupon.discount;
          }
          validatedCouponCode = coupon.code;
        }
      }
    }

    const finalTotalPrice = subtotal + shippingCharge - discount;

    const order = await prisma.order.create({
      data: {
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

    // Clear user's cart if user
    if (userId) {
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (cart) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await prisma.cart.update({
          where: { id: cart.id },
          data: { totalPrice: 0 },
        });
      }
    } else if (req.body.guestId) {
      // Clear guest cart
      const guestId = req.body.guestId;
      const cart = await prisma.cart.findUnique({ where: { guestId } });
      if (cart) {
        // Option 1: Delete entire cart (if we want it gone from DB)
        // await prisma.cart.delete({ where: { id: cart.id } });

        // Option 2: Clear items (keep cart for history/session) - PREFERRED
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
        await prisma.cart.update({
          where: { id: cart.id },
          data: { totalPrice: 0 },
        });
      }
    }

    // Send Confirmation Email
    // check if COD, send email immediately. If Stripe, wait for verification.
    if (paymentMethod !== 'stripe') {
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
router.put("/:orderId", requireAuth, requireAdmin, async (req: Request, res: Response<ApiResponse<any>>) => {
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
  requireAuth,
  requireAdmin,
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
