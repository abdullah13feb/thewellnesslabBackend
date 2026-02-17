import { Router, Request, Response } from "express";
import { ApiResponse } from "../types/index.js";
import prisma from "../lib/prisma.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = Router();

// Helper to find cart by identifier (userId or guestId)
const findCart = async (identifier: string) => {
  const isUser = identifier.startsWith("user_");
  return await prisma.cart.findUnique({
    where: isUser ? { userId: identifier } : { guestId: identifier },
    include: { items: { include: { product: true } } },
  });
};

// ADMIN: Get all carts
router.get("/admin/all", requireAuth, requireAdmin, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const carts = await prisma.cart.findMany({
      where: {
        items: {
          some: {} // Only return carts that have at least one item
        }
      },
      include: {
        items: { include: { product: true } },
        user: { select: { email: true, id: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    res.json({ success: true, data: carts });
  } catch (error) {
    console.error("Admin fetch carts error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch carts" });
  }
});

// ADMIN: Delete a cart by ID
router.delete("/admin/:id", requireAuth, requireAdmin, async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    await prisma.cart.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: "Cart deleted" });
  } catch (error) {
    console.error("Admin delete cart error:", error);
    res.status(500).json({ success: false, error: "Failed to delete cart" });
  }
});

// GET cart by identifier
router.get("/:identifier", async (req: Request, res: Response<ApiResponse<any>>) => {
  try {
    const { identifier } = req.params;
    let cart = await findCart(identifier);

    if (!cart) {
      const isUser = identifier.startsWith("user_");

      if (isUser) {
        // Ensure user exists before creating cart to avoid FK constraint error
        const userExists = await prisma.user.findUnique({ where: { id: identifier } });
        if (!userExists) {
          // Create placeholder user so cart creation succeeds
          await prisma.user.create({
            data: {
              id: identifier,
              email: `${identifier}@placeholder.com`, // Placeholder email
              role: 'USER'
            }
          });
        }
      }

      // Create new cart
      cart = await prisma.cart.create({
        data: isUser ? { userId: identifier } : { guestId: identifier },
        include: { items: { include: { product: true } } },
      });
    }

    res.json({ success: true, data: cart });
  } catch (error) {
    console.error("Get cart error:", error);
    res.status(500).json({ success: false, error: "Failed to fetch cart" });
  }
});

// ADD item to cart
router.post(
  "/:identifier/items",
  async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
      const { identifier } = req.params;
      const { productId, quantity, price } = req.body;

      if (!productId || !quantity || price === undefined) {
        return res.status(400).json({
          success: false,
          error: "productId, quantity, and price are required",
        });
      }

      let cart = await findCart(identifier);
      if (!cart) {
        const isUser = identifier.startsWith("user_");
        cart = await prisma.cart.create({
          data: isUser ? { userId: identifier } : { guestId: identifier },
          include: { items: { include: { product: true } } }
        });
      }

      const existingItem = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId },
      });

      if (existingItem) {
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: existingItem.quantity + quantity },
        });
      } else {
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            quantity,
            price: parseFloat(price),
          },
        });
      }

      // Recalculate total
      const updatedCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: true },
      });

      const totalPrice = updatedCart?.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      ) || 0;

      await prisma.cart.update({
        where: { id: cart.id },
        data: { totalPrice },
      });

      // Refetch with products
      const finalCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: { include: { product: true } } },
      });

      res.status(201).json({ success: true, data: finalCart });
    } catch (error: any) {
      console.error("Add item error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to add to cart",
        details: error.message,
        code: error.code // Useful for Prisma errors
      });
    }
  }
);

// UPDATE cart item quantity
router.put(
  "/:identifier/items/:productId",
  async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
      const { identifier, productId } = req.params;
      const { quantity } = req.body;

      if (quantity === undefined) {
        return res.status(400).json({ success: false, error: "quantity is required" });
      }

      const cart = await findCart(identifier);
      if (!cart) {
        return res.status(404).json({ success: false, error: "Cart not found" });
      }

      if (quantity <= 0) {
        await prisma.cartItem.deleteMany({
          where: { cartId: cart.id, productId },
        });
      } else {
        // We know the item exists if we're updating it usually, but let's be safe
        // Prisma update requires unique where. cartId_productId is unique.
        await prisma.cartItem.update({
          where: { cartId_productId: { cartId: cart.id, productId } },
          data: { quantity },
        });
      }

      // Recalculate
      const updatedCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: true },
      });

      const totalPrice = updatedCart?.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      ) || 0;

      await prisma.cart.update({
        where: { id: cart.id },
        data: { totalPrice },
      });

      const finalCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: { include: { product: true } } },
      });

      res.json({ success: true, data: finalCart });
    } catch (error) {
      console.error("Update item error:", error);
      res.status(500).json({ success: false, error: "Failed to update cart" });
    }
  }
);

// REMOVE item from cart
router.delete(
  "/:identifier/items/:productId",
  async (req: Request, res: Response<ApiResponse<any>>) => {
    try {
      const { identifier, productId } = req.params;

      const cart = await findCart(identifier);
      if (!cart) {
        return res.status(404).json({ success: false, error: "Cart not found" });
      }

      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id, productId },
      });

      const updatedCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: true },
      });

      const totalPrice = updatedCart?.items.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      ) || 0;

      await prisma.cart.update({
        where: { id: cart.id },
        data: { totalPrice },
      });

      const finalCart = await prisma.cart.findUnique({
        where: { id: cart.id },
        include: { items: { include: { product: true } } },
      });

      res.json({ success: true, data: finalCart });
    } catch (error) {
      console.error("Remove item error:", error);
      res.status(500).json({ success: false, error: "Failed to remove item" });
    }
  }
);

// CLEAR entire cart
router.delete(
  "/:identifier",
  async (req: Request, res: Response<ApiResponse<null>>) => {
    try {
      const { identifier } = req.params;

      const cart = await findCart(identifier);
      if (!cart) {
        return res.status(404).json({ success: false, error: "Cart not found" });
      }

      await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await prisma.cart.update({
        where: { id: cart.id },
        data: { totalPrice: 0 },
      });

      res.json({ success: true, message: "Cart cleared successfully" });
    } catch (error) {
      console.error("Clear cart error:", error);
      res.status(500).json({ success: false, error: "Failed to clear cart" });
    }
  }
);

export default router;
