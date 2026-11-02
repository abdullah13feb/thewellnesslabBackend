import prisma from "./prisma.js";

// Keys used in Lead.dynamicFields for Find Your Panel quiz leads. The admin portal and the
// notification email read these names, so keep them stable.
export const QUIZ_FIELDS = {
  suggested: "Suggested Product",
  also: "Also Consider",
  path: "Quiz Path",
  page: "Quiz Page",
  eventId: "Quiz Event ID",
} as const;

const ANSWER_LABELS: Record<string, string> = {
  who: "Who Is It For",
  goal: "Goal",
  coverage: "Coverage",
  practice: "Practice",
  setting: "Where It Will Live",
  petType: "Pet",
  petFocus: "Pet Focus",
  petStyle: "Pet Sessions",
};

const clean = (v: unknown, max = 300) =>
  typeof v === "string" || typeof v === "number" ? String(v).trim().slice(0, max) : "";

// "REX PET POD" -> "rex-pet-pod", the Product slug.
export const productSlug = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Turn the quiz payload sent by the storefront into readable dynamicFields.
export function buildQuizFields(quiz: any): Record<string, string> | null {
  if (!quiz || typeof quiz !== "object") return null;
  const match = clean(quiz.match, 60);
  if (!match) return null;

  const fields: Record<string, string> = { [QUIZ_FIELDS.suggested]: match };
  const also = clean(quiz.also_consider, 60);
  if (also) fields[QUIZ_FIELDS.also] = also;

  const codes = quiz.answer_codes && typeof quiz.answer_codes === "object" ? quiz.answer_codes : {};
  fields[QUIZ_FIELDS.path] = codes.who === "pet" ? "Pet" : "People";

  const answers = quiz.answers && typeof quiz.answers === "object" ? quiz.answers : {};
  for (const [key, label] of Object.entries(ANSWER_LABELS)) {
    const v = clean(answers[key], 120);
    if (v) fields[label] = v;
  }

  const page = clean(quiz.page, 500);
  if (page) fields[QUIZ_FIELDS.page] = page;
  const eventId = clean(quiz.event_id, 80);
  if (eventId) fields[QUIZ_FIELDS.eventId] = eventId;
  return fields;
}

export function suggestedProductOf(lead: { dynamicFields?: unknown }): string {
  const df = lead.dynamicFields;
  if (!df || typeof df !== "object") return "";
  return clean((df as Record<string, unknown>)[QUIZ_FIELDS.suggested], 60);
}

const phoneKey = (p?: string | null) => String(p || "").replace(/\D/g, "").slice(-9);
const emailKey = (e?: string | null) => String(e || "").trim().toLowerCase();

export type QuizPurchase = {
  suggestedProduct: string;
  suggestedSlug: string;
  // PURCHASED_SUGGESTED: bought the product the quiz suggested
  // PURCHASED_OTHER: placed an order, but not for the suggested product
  // NOT_PURCHASED: no order since the quiz
  status: "PURCHASED_SUGGESTED" | "PURCHASED_OTHER" | "NOT_PURCHASED";
  orders: {
    id: string;
    createdAt: Date;
    totalPrice: number;
    status: string;
    paymentStatus: string;
    paymentMethod: string;
    products: string[];
    includesSuggested: boolean;
  }[];
};

// For quiz leads, find the orders placed after the quiz with the same email or phone, and say
// whether they include the suggested product. Cancelled orders and unpaid card orders don't count.
export async function attachQuizPurchases<T extends { createdAt: Date; email?: string | null; phone?: string | null; dynamicFields?: unknown }>(
  leads: T[],
): Promise<(T & { quizPurchase?: QuizPurchase })[]> {
  const quizLeads = leads.filter((l) => suggestedProductOf(l) && (emailKey(l.email) || phoneKey(l.phone)));
  if (quizLeads.length === 0) return leads;

  const since = new Date(Math.min(...quizLeads.map((l) => new Date(l.createdAt).getTime())));
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: since },
      status: { not: "CANCELLED" },
      OR: [{ paymentStatus: "paid" }, { paymentMethod: "cod" }],
    },
    select: {
      id: true,
      createdAt: true,
      totalPrice: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      guestEmail: true,
      guestPhone: true,
      user: { select: { email: true } },
      items: { select: { product: { select: { slug: true, name: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  return leads.map((lead) => {
    const suggested = suggestedProductOf(lead);
    if (!suggested) return lead;
    const slug = productSlug(suggested);
    const email = emailKey(lead.email);
    const phone = phoneKey(lead.phone);
    const from = new Date(lead.createdAt).getTime();

    const mine = orders
      .filter((o) => o.createdAt.getTime() >= from)
      .filter((o) => {
        const oEmails = [emailKey(o.guestEmail), emailKey(o.user?.email)].filter(Boolean);
        const oPhone = phoneKey(o.guestPhone);
        return (email && oEmails.includes(email)) || (phone.length >= 7 && oPhone === phone);
      })
      .map((o) => ({
        id: o.id,
        createdAt: o.createdAt,
        totalPrice: o.totalPrice,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        products: o.items.map((i) => i.product?.name || i.product?.slug || "").filter(Boolean),
        includesSuggested: o.items.some((i) => i.product?.slug === slug),
      }));

    const status: QuizPurchase["status"] = mine.some((o) => o.includesSuggested)
      ? "PURCHASED_SUGGESTED"
      : mine.length
        ? "PURCHASED_OTHER"
        : "NOT_PURCHASED";

    return { ...lead, quizPurchase: { suggestedProduct: suggested, suggestedSlug: slug, status, orders: mine } };
  });
}
