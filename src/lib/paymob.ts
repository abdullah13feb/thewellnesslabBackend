import axios from "axios";
import crypto from "crypto";

const PAYMOB_BASE = "https://uae.paymob.com";

const signingKey = () => (process.env.PAYMOB_PRIVATE_API_KEY || process.env.PAYMOB_SECRET_KEY || "").trim();

/**
 * The embedded card form is backed by an intention created before the order exists.
 * The signature ties the reserved order id to the amount the intention charges, so the order
 * created at pay time can be checked against it (stateless, no extra table).
 */
export function signReservation(reference: string, amountCents: number, clientSecret: string) {
  return crypto
    .createHmac("sha256", signingKey())
    .update(`${reference}|${amountCents}|${clientSecret}`)
    .digest("hex");
}

export function verifyReservation(reference: string, amountCents: number, clientSecret: string, signature: string) {
  if (!reference || !clientSecret || !signature || !signingKey()) return false;
  const expected = Buffer.from(signReservation(reference, amountCents, clientSecret));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

let cachedToken: { token: string; at: number } | null = null;

async function authToken() {
  if (cachedToken && Date.now() - cachedToken.at < 30 * 60 * 1000) return cachedToken.token;
  const { data } = await axios.post(`${PAYMOB_BASE}/api/auth/tokens`, {
    api_key: (process.env.PAYMOB_API_KEY || "").trim(),
  });
  cachedToken = { token: data.token, at: Date.now() };
  return data.token as string;
}

export type PaymobTransactionCheck =
  | { paid: true; merchantOrderId: string; amountCents: number; paymobOrderId: string }
  | { paid: false; reason: string };

/**
 * Ask Paymob for the transaction itself instead of trusting the browser redirect:
 * it must be successful, not pending, in AED and belong to the expected order.
 */
export async function checkPaymobTransaction(
  transactionId: string,
  expectedOrderId: string,
  expectedAmountCents: number
): Promise<PaymobTransactionCheck> {
  if (!transactionId || !/^\d+$/.test(String(transactionId))) return { paid: false, reason: "Missing transaction id" };

  const token = await authToken();
  const { data: t } = await axios.get(`${PAYMOB_BASE}/api/acceptance/transactions/${transactionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const merchantOrderId = String(t?.order?.merchant_order_id || "").split("_")[0];
  if (merchantOrderId !== expectedOrderId) return { paid: false, reason: "Transaction belongs to another order" };
  if (t.success !== true || t.pending === true) return { paid: false, reason: "Transaction not successful" };
  if (t.is_voided === true || t.is_refunded === true) return { paid: false, reason: "Transaction voided or refunded" };
  if (t.currency !== "AED") return { paid: false, reason: "Unexpected currency" };
  if (Math.abs(Number(t.amount_cents) - expectedAmountCents) > 1) return { paid: false, reason: "Amount mismatch" };

  return { paid: true, merchantOrderId, amountCents: Number(t.amount_cents), paymobOrderId: String(t?.order?.id || "") };
}
