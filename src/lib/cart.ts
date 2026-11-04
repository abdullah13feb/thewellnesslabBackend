import prisma from "./prisma.js";

/** Empties a cart but keeps the cart row, for a signed-in user (userId) or a guest (guestId). */
export async function clearCart(where: { userId: string } | { guestId: string }) {
  const cart = await prisma.cart.findUnique({ where });
  if (!cart) return;
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  await prisma.cart.update({ where: { id: cart.id }, data: { totalPrice: 0 } });
}

// Paid on a provider's page or form: the cart is kept until the payment succeeds, so a customer who
// cancels or is declined comes back to a full cart.
export const ONLINE_PAYMENT_METHODS = ["stripe", "paymob", "apple_pay", "tabby"];
