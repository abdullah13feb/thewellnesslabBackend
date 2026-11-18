import { randomInt } from "node:crypto";
import prisma from "./prisma.js";

/**
 * Recovery Passport (the event quiz at /recovery-passport, lead tag "quiz map").
 * Each person who finishes the quiz gets their own single-use coupon: AED 2,250 off the panel the quiz
 * recommended, plus a free REX MINI that the team adds to the order.
 * Goals, personas and the goal-to-panel match are the approved quiz's (Recovery Passport Quiz.html).
 */
export const PASSPORT_SOURCE = "quiz map";
export const PASSPORT_PREFIX = "RX-";
export const PASSPORT_OFFER = 2250;
export const PASSPORT_VALID_UNTIL = new Date(Date.UTC(2026, 11, 15, 19, 59, 59)); // 15 Dec 2026, 23:59:59 UAE time
export const PASSPORT_VALID_UNTIL_LABEL = "15 December 2026";

export const PASSPORT_PANELS = {
  pro: { slug: "rex-pro", name: "REX PRO", size: "3 FT" },
  core: { slug: "rex-core", name: "REX CORE", size: "6 FT" },
  prestige: { slug: "rex-prestige", name: "REX PRESTIGE", size: "6 FT WIDE" },
} as const;

export const PASSPORT_GOALS = {
  skin: { persona: "The Glow Builder", panel: "pro" },
  muscle: { persona: "The Go-Again Athlete", panel: "core" },
  joints: { persona: "The Free Mover", panel: "core" },
  sleep: { persona: "The Night Recharger", panel: "pro" },
} as const;

export const PASSPORT_STATIONS: Record<string, string> = { panel: "Red Light Panel", legs: "Compression Legs" };

export type PassportGoal = keyof typeof PASSPORT_GOALS;

export function isPassportGoal(v: unknown): v is PassportGoal {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PASSPORT_GOALS, v);
}

export function panelForGoal(goal: PassportGoal) {
  return PASSPORT_PANELS[PASSPORT_GOALS[goal].panel];
}

export function isPassportCode(code: unknown): boolean {
  return typeof code === "string" && code.toUpperCase().startsWith(PASSPORT_PREFIX);
}

// No 0/O, 1/I/L: the code is read aloud and typed from WhatsApp. 31^6 codes, so they can't be guessed.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function randomCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return PASSPORT_PREFIX + s;
}

export async function newPassportCode(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    if (!(await prisma.coupon.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  throw new Error("Could not find a free passport code");
}

/** A passport code works for one order: a paid order, or a cash-on-delivery order that wasn't cancelled. */
export async function passportCodeUsed(code: string): Promise<boolean> {
  const n = await prisma.order.count({
    where: {
      couponCode: code.toUpperCase(),
      OR: [{ paymentStatus: "paid" }, { paymentMethod: "cod", NOT: { status: "CANCELLED" } }],
    },
  });
  return n > 0;
}

export function passportCouponDescription(panelName: string): string {
  return `Recovery Passport (${PASSPORT_SOURCE}): AED ${PASSPORT_OFFER.toLocaleString("en-US")} off ${panelName}, plus a free REX MINI. Single use.`;
}
