import axios from "axios";
import crypto from "crypto";

// Meta Conversions API. The token is server only: never send it to a browser or log it.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const PIXEL_ID = (process.env.META_PIXEL_ID || "1209564507911731").trim();
const TOKEN = () => (process.env.META_CAPI_TOKEN || "").trim();
const TEST_CODE = () => (process.env.META_TEST_EVENT_CODE || "").trim();

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
const hashed = (v?: string | null) => (v ? [sha256(v)] : undefined);

const normEmail = (v?: string | null) => {
  const e = (v || "").trim().toLowerCase();
  return e.includes("@") && !e.endsWith("@thewellnesslab.ae") ? e : "";
};

// Digits with country code, no leading zeros. Local UAE numbers (05x / 5x) get 971.
export function normPhone(v?: string | null) {
  let d = String(v || "").replace(/\D/g, "").replace(/^00/, "");
  if (/^05\d{8}$/.test(d)) d = `971${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `971${d}`;
  else if (/^9710\d{9}$/.test(d)) d = `971${d.slice(4)}`;
  return d.length >= 8 ? d : "";
}

const normText = (v?: string | null) => (v || "").trim().toLowerCase().replace(/[^\p{L}]/gu, "");

export function splitName(full?: string | null) {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || "", last: parts.slice(1).join(" ") };
}

export type Customer = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  city?: string | null;
  externalId?: string | null;
};

// Customer details as Meta's hashed user_data fields.
export function userData(c: Customer) {
  const { first, last } = splitName(c.name);
  const data: Record<string, unknown> = {
    em: hashed(normEmail(c.email)),
    ph: hashed(normPhone(c.phone)),
    fn: hashed(normText(first)),
    ln: hashed(normText(last)),
    ct: hashed(normText(c.city)),
    country: hashed("ae"),
    external_id: hashed((c.externalId || "").trim()),
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  return data;
}

export type MetaEvent = {
  event_name: string;
  event_id: string;
  event_time?: number;
  action_source: "website" | "business_messaging" | "system_generated";
  messaging_channel?: "whatsapp";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
};

// Sends one event. Returns true when Meta accepted it. Never throws: tracking must not break a payment.
export async function sendMetaEvent(event: MetaEvent): Promise<boolean> {
  const token = TOKEN();
  if (!token) {
    console.warn(`[Meta CAPI] META_CAPI_TOKEN is not set; ${event.event_name} ${event.event_id} not sent`);
    return false;
  }
  const body: Record<string, unknown> = {
    data: [{ event_time: Math.floor(Date.now() / 1000), ...event }],
  };
  if (TEST_CODE()) body.test_event_code = TEST_CODE();

  try {
    const res = await axios.post(`https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events`, body, {
      params: { access_token: token },
      timeout: 8000,
    });
    console.log(
      `[Meta CAPI] ${event.event_name} ${event.event_id} sent (received ${res.data?.events_received ?? "?"}${TEST_CODE() ? ", test mode" : ""})`
    );
    return true;
  } catch (err: any) {
    console.error(`[Meta CAPI] ${event.event_name} ${event.event_id} failed:`, err?.response?.data?.error || err.message);
    return false;
  }
}

// The same product ids as the website pixel and the catalog feed (e.g. REX-ULTRA).
export const contentId = (slugOrName: string) =>
  String(slugOrName || "").trim().toUpperCase().replace(/\s+/g, "-");

export const firstIp = (header?: string | string[]) =>
  String(Array.isArray(header) ? header[0] : header || "").split(",")[0].trim();
