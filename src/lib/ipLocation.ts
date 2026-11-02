import axios from "axios";
import type { Request } from "express";

// Keys used in Lead.dynamicFields; the notification email and the admin portal read these names.
export const IP_FIELDS = {
  ip: "IP Address",
  location: "IP Location",
  isp: "Internet Provider",
} as const;

// The visitor's IP. Behind the ALB / API Gateway the first x-forwarded-for entry is the client.
export function clientIpOf(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  return (first || req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "").slice(0, 64);
}

const isPrivate = (ip: string) =>
  !ip ||
  ip === "::1" ||
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) ||
  /^(fe80|fc|fd)/i.test(ip);

// IP address plus approximate location (city, region, country) and provider, as dynamicFields.
// Uses ip-api.com, like the chat route. Never throws, and gives up after 2.5 s so a slow lookup
// can't hold up a lead; then only the IP is saved.
export async function ipFields(req: Request): Promise<Record<string, string>> {
  const ip = clientIpOf(req);
  if (!ip) return {};
  const out: Record<string, string> = { [IP_FIELDS.ip]: ip };
  if (isPrivate(ip)) return out;
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}`, {
      params: { fields: "status,country,regionName,city,isp" },
      timeout: 2500,
    });
    if (data?.status === "success") {
      const place = [data.city, data.regionName, data.country]
        .filter((v: unknown, i: number, a: unknown[]) => v && a.indexOf(v) === i)
        .join(", ");
      if (place) out[IP_FIELDS.location] = place;
      if (data.isp) out[IP_FIELDS.isp] = String(data.isp).slice(0, 120);
    }
  } catch (err: any) {
    console.warn(`[IP location] lookup failed for ${ip}:`, err?.message || err);
  }
  return out;
}
