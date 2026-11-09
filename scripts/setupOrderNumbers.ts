// One-time setup for the customer order confirmation email (TWL_OrderConfirmation_Handoff).
// Run AFTER `npx prisma db push` has added Order.orderNumber, and BEFORE deploying the backend that reads it:
//
//   npx tsx scripts/setupOrderNumbers.ts
//
// 1. Numbers existing orders TWL-10001, TWL-10002, ... by creation date and starts the sequence after them,
//    so the next order gets the next number. Skipped once numbers are at 10001 or above (safe to re-run).
// 2. Creates coupon REDALLOVERAGAIN (AED 500 off), which the email footer promises. An existing coupon with
//    that code is left as it is.

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";

dotenv.config();

const FIRST_ORDER_NUMBER = 10001;
const COUPON_CODE = "REDALLOVERAGAIN";

// The direct connection: the pooled one (pgbouncer) does not keep the table lock across statements.
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });

async function setupOrderNumbers() {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE "Order" IN EXCLUSIVE MODE`);
    const [{ max }] = await tx.$queryRawUnsafe<{ max: number | null }[]>(`SELECT MAX("orderNumber") AS max FROM "Order"`);

    if (max !== null && max >= FIRST_ORDER_NUMBER) {
      console.log(`Order numbers already set up (highest is TWL-${max}). Skipping renumbering.`);
    } else {
      const renumbered = await tx.$executeRawUnsafe(`
        UPDATE "Order" o
        SET "orderNumber" = ${FIRST_ORDER_NUMBER - 1} + r.rn
        FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt", id) AS rn FROM "Order") r
        WHERE o.id = r.id`);
      console.log(`Numbered ${renumbered} existing orders from TWL-${FIRST_ORDER_NUMBER}.`);
    }

    // Next nextval() returns highest + 1, or FIRST_ORDER_NUMBER when there are no orders yet.
    const [{ next }] = await tx.$queryRawUnsafe<{ next: bigint }[]>(`
      SELECT setval(
        pg_get_serial_sequence('"Order"', 'orderNumber'),
        GREATEST((SELECT MAX("orderNumber") FROM "Order"), ${FIRST_ORDER_NUMBER - 1})
      ) + 1 AS next`);
    console.log(`Next order will be TWL-${next}.`);
  });
}

async function setupCoupon() {
  const existing = await prisma.coupon.findUnique({ where: { code: COUPON_CODE } });
  if (existing) {
    console.log(
      `Coupon ${COUPON_CODE} already exists (${existing.type} ${existing.discount}, ${existing.isActive ? "active" : "INACTIVE"}). Left unchanged.`
    );
    return;
  }
  await prisma.coupon.create({
    data: {
      code: COUPON_CODE,
      discount: 500,
      type: "FIXED",
      isActive: true,
      description: "AED 500 off the next order (order confirmation email)",
    },
  });
  console.log(`Created coupon ${COUPON_CODE}: AED 500 off, active, no expiry, no minimum.`);
}

try {
  await setupOrderNumbers();
  await setupCoupon();
} finally {
  await prisma.$disconnect();
}
