import type { Request } from "express";

// Keys used in Lead.dynamicFields; the lead alert email and the admin portal read these names.
export const TRACKING_FIELDS = {
  campaign: "UTM Campaign",
  device: "Device",
} as const;

// A short, readable device for the lead alert, e.g. "iPhone · Instagram app" or "Windows PC · Chrome".
export function deviceOf(ua: string): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? /Mobile/.test(ua) ? "Android phone" : "Android tablet"
        : /CrOS/.test(ua)
          ? "Chromebook"
          : /Macintosh|Mac OS X/.test(ua)
            ? "Mac"
            : /Windows/.test(ua)
              ? "Windows PC"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  // In-app browsers first: their user agents also name Safari or Chrome.
  const browser = /Instagram/.test(ua)
    ? "Instagram app"
    : /FBAN|FBAV|FB_IAB/.test(ua)
      ? "Facebook app"
      : /TikTok|musical_ly|BytedanceWebview/.test(ua)
        ? "TikTok app"
        : /Edg\//.test(ua)
          ? "Edge"
          : /OPR\/|Opera/.test(ua)
            ? "Opera"
            : /SamsungBrowser/.test(ua)
              ? "Samsung Internet"
              : /CriOS|Chrome\//.test(ua)
                ? "Chrome"
                : /FxiOS|Firefox\//.test(ua)
                  ? "Firefox"
                  : /Safari\//.test(ua)
                    ? "Safari"
                    : "";
  return [os, browser].filter(Boolean).join(" · ").slice(0, 80);
}

// Campaign (sent by the storefront from the visitor's stored UTM tags) and device (from the request).
export function trackingFields(req: Request, utmCampaign: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const campaign = typeof utmCampaign === "string" ? utmCampaign.trim().slice(0, 200) : "";
  if (campaign) out[TRACKING_FIELDS.campaign] = campaign;
  const device = deviceOf(String(req.headers["user-agent"] || ""));
  if (device) out[TRACKING_FIELDS.device] = device;
  return out;
}
