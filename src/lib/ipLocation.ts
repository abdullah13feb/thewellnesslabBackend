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
  const { location, isp } = await lookupIp(ip);
  if (location) out[IP_FIELDS.location] = location;
  if (isp) out[IP_FIELDS.isp] = isp;
  return out;
}

// Approximate location ("Dubai, United Arab Emirates") and provider for an IP, e.g. an order's clientIp.
// Never throws; empty when the IP is private or the lookup fails or takes over 2.5 s.
export async function lookupIp(ip: string): Promise<{ location?: string; isp?: string }> {
  if (!ip || isPrivate(ip)) return {};
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${encodeURIComponent(ip)}`, {
      params: { fields: "status,country,regionName,city,isp" },
      timeout: 2500,
    });
    if (data?.status !== "success") return {};
    const place = [data.city, data.regionName, data.country]
      .filter((v: unknown, i: number, a: unknown[]) => v && a.indexOf(v) === i)
      .join(", ");
    return { location: place || undefined, isp: data.isp ? String(data.isp).slice(0, 120) : undefined };
  } catch (err: any) {
    console.warn(`[IP location] lookup failed for ${ip}:`, err?.message || err);
    return {};
  }
}
