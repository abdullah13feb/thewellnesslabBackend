// WhatsApp broadcast dispatcher: sends each campaign recipient at its own sendAt time.
//
// Runs from two places, and both may run at once:
//  - On AWS Lambda, the broadcastTick function, which EventBridge invokes every minute (src/broadcastTick.ts).
//  - On a long-running server (npm run dev / pm2), the interval in whatsappScheduler.ts.
// Each recipient is claimed with a conditional update (PENDING -> SENDING) before it is sent, so two runners
// can never send the same message twice.
import prisma from "./prisma.js";
import { normalizeDeviceId, sendWhatsappInteractive, sendWhatsappMediaMessage, sendWhatsappMessage } from "./whatsappGateway.js";
import { specsToButtons, type NotifyButton } from "./whatsappNotify.js";
import { WA_PHONE_KEY } from "./whatsappLead.js";

const ACTIVE = ["SCHEDULED", "SENDING"];
// Never send two broadcast messages closer together than this, whatever the schedule says.
export const MIN_GAP_MS = 3000;
// A message claimed but never finished (the runner was killed mid-send) is marked failed after this long,
// not retried: it may already have been delivered.
const STALE_CLAIM_MS = 10 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type DispatchResult = { sent: number; failed: number; skipped: number; completed: number };

/**
 * Sends every pending recipient whose sendAt falls before the end of the time budget, waiting until each
 * one's exact time. Returns when nothing more is due within the budget.
 */
export async function dispatchDueRecipients({ budgetMs = 50000 }: { budgetMs?: number } = {}): Promise<DispatchResult> {
  const deadline = Date.now() + budgetMs;
  const out: DispatchResult = { sent: 0, failed: 0, skipped: 0, completed: 0 };
  let lastSendAt = 0;
  // Last message sent per campaign in this run: when catching up on overdue messages (e.g. the sender was
  // down), each one still waits its planned gap after the previous one instead of all going out at once.
  const lastByCampaign = new Map<string, { planned: number; actual: number }>();

  await failStaleClaims();

  while (Date.now() < deadline - 2000) {
    const horizon = new Date(deadline - 2000);
    const next = await prisma.whatsappCampaignRecipient.findFirst({
      where: {
        status: "PENDING",
        campaign: { status: { in: ACTIVE } },
        // Recipients created before per-recipient times existed go out when their campaign is due.
        OR: [{ sendAt: { lte: horizon } }, { sendAt: null, campaign: { scheduledAt: { lte: horizon } } }],
      },
      orderBy: [{ sendAt: "asc" }, { id: "asc" }],
      select: { id: true, sendAt: true, campaignId: true },
    });
    if (!next) break;

    const planned = next.sendAt ? next.sendAt.getTime() : 0;
    const prev = lastByCampaign.get(next.campaignId);
    const plannedGap = prev && planned ? Math.max(0, planned - prev.planned) : 0;
    const due = Math.max(planned, lastSendAt + MIN_GAP_MS, prev ? prev.actual + plannedGap : 0);
    const wait = due - Date.now();
    if (wait > 0) {
      if (Date.now() + wait > deadline - 2000) break;
      await sleep(wait);
    }

    const result = await sendOne(next.id);
    if (result === "sent") out.sent++;
    else if (result === "failed") out.failed++;
    else out.skipped++;
    if (result !== "skipped") {
      lastSendAt = Date.now();
      lastByCampaign.set(next.campaignId, { planned, actual: lastSendAt });
    }
  }

  out.completed = await completeFinishedCampaigns();
  return out;
}

async function sendOne(recipientId: string): Promise<"sent" | "failed" | "skipped"> {
  // Claim it; another runner may have taken it, or the campaign may have been cancelled while we waited.
  const claimed = await prisma.whatsappCampaignRecipient.updateMany({
    where: { id: recipientId, status: "PENDING", campaign: { status: { in: ACTIVE } } },
    data: { status: "SENDING", attemptedAt: new Date() },
  });
  if (claimed.count === 0) return "skipped";

  const r = await prisma.whatsappCampaignRecipient.findUnique({
    where: { id: recipientId },
    include: { campaign: { include: { template: true } } },
  });
  if (!r) return "skipped";
  const campaign = r.campaign;

  if (campaign.status === "SCHEDULED") {
    await prisma.whatsappCampaign.updateMany({ where: { id: campaign.id, status: "SCHEDULED" }, data: { status: "SENDING" } });
  }

  // Values for {{name}} {{phone}} {{email}} {{city}} {{passport}} in the message and in button values.
  const lead = r.leadId
    ? await prisma.lead.findUnique({ where: { id: r.leadId }, select: { id: true, name: true, email: true, city: true, dynamicFields: true } })
    : null;
  const df = (lead?.dynamicFields as Record<string, unknown>) || {};
  const vars: Record<string, string> = {
    name: String(r.name || lead?.name || "").trim(),
    phone: `+${r.phone}`,
    email: String(lead?.email || ""),
    city: String(lead?.city || ""),
    passport: String(df["Passport Code"] || ""),
    ...((r.variables as Record<string, string>) || {}),
  };
  const fill = (s: string) => s.replace(/{{\s*(\w+)\s*}}/g, (m, k) => (k in vars ? String(vars[k] ?? "") : m));
  const text = fill(campaign.customBody || campaign.template?.body || "").trim();

  const t = campaign.template;
  const hasMedia = !!(t && t.type !== "TEXT" && t.mediaUrl);
  const specs = Array.isArray(campaign.buttons) ? (campaign.buttons as unknown as NotifyButton[]) : [];
  // Buttons whose value is empty for this person (e.g. "Copy code" with no {{passport}}) are left out.
  const buttons = !hasMedia && specs.length ? specsToButtons(specs, vars) : [];
  const footer = campaign.footer ? fill(campaign.footer).trim() : "";

  let res: { success: boolean; error?: string };
  let sentAs: "interactive" | "text" | "media" = hasMedia ? "media" : "text";
  try {
    if (hasMedia) {
      res = await sendWhatsappMediaMessage(campaign.sessionId, r.phone, text, t!.mediaUrl!, t!.type, campaign.deviceId);
    } else {
      res = { success: false };
      if (buttons.length) {
        res = await sendWhatsappInteractive(r.phone, text, buttons, campaign.deviceId, footer || undefined);
        if (res.success) sentAs = "interactive";
      }
      // No buttons, or the gateway refused the interactive message: send it as a normal text.
      if (!res.success) res = await sendWhatsappMessage(campaign.sessionId, r.phone, footer && buttons.length ? `${text}\n\n${footer}` : text, campaign.deviceId);
    }
  } catch (e: any) {
    res = { success: false, error: e?.message || "send failed" };
  }

  await prisma.whatsappCampaignRecipient.update({
    where: { id: r.id },
    data: res.success
      ? { status: "SENT", sentAt: new Date(), error: buttons.length && sentAs === "text" ? "Buttons could not be sent; went as a normal message" : null }
      : { status: "FAILED", error: res.error || "WhatsApp gateway rejected the message. Check the device connection." },
  });
  await prisma.whatsappCampaign.update({
    where: { id: campaign.id },
    data: res.success ? { successCount: { increment: 1 } } : { failCount: { increment: 1 } },
  });

  const shown = sentAs === "interactive"
    ? `${text}${footer ? `\n\n${footer}` : ""}\n\n${buttons.map((b) => `[${b.params.display_text}]`).join(" ")}`
    : text;
  await logToChat(r, lead, campaign, shown, res.success).catch((e) => console.error("Broadcast: chat log failed:", e?.message));
  return res.success ? "sent" : "failed";
}

// Shows the broadcast message in the lead's WhatsApp history (Leads tab and CRM inbox).
async function logToChat(
  r: { phone: string; name: string | null },
  lead: { id: string; dynamicFields: unknown } | null,
  campaign: { name: string; deviceId: string },
  text: string,
  ok: boolean,
) {
  const wa = (lead?.dynamicFields as any)?.[WA_PHONE_KEY];
  if (ok && lead) await prisma.lead.update({ where: { id: lead.id }, data: { whatsappSent: true, whatsappSentAt: new Date() } });
  await prisma.wellnessLabMessageLog.create({
    data: {
      timestamp: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Dubai", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }),
      phoneNumber: wa ? String(wa) : r.phone,
      customerName: r.name || "WhatsApp Customer",
      direction: "Outgoing",
      messageContent: text,
      campaign: `Broadcast: ${campaign.name}`.slice(0, 190),
      status: ok ? "Sent" : "Failed",
      deviceId: normalizeDeviceId(campaign.deviceId),
    },
  });
}

async function failStaleClaims() {
  const stale = await prisma.whatsappCampaignRecipient.findMany({
    where: { status: "SENDING", attemptedAt: { lt: new Date(Date.now() - STALE_CLAIM_MS) } },
    select: { id: true, campaignId: true },
  });
  for (const s of stale) {
    const done = await prisma.whatsappCampaignRecipient.updateMany({
      where: { id: s.id, status: "SENDING" },
      data: { status: "FAILED", error: "Sending was interrupted; not retried in case it was delivered." },
    });
    if (done.count) await prisma.whatsappCampaign.update({ where: { id: s.campaignId }, data: { failCount: { increment: 1 } } });
  }
}

// Active campaigns with nothing left to send are COMPLETED.
async function completeFinishedCampaigns(): Promise<number> {
  const done = await prisma.whatsappCampaign.updateMany({
    where: {
      status: { in: ACTIVE },
      batchId: null, // gateway bulk batches are finished by pollActiveCampaigns
      recipients: { none: { status: { in: ["PENDING", "SENDING"] } } },
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
    },
    data: { status: "COMPLETED" },
  });
  return done.count;
}

/**
 * Send times for recipients that were not given one: from `start`, one every delaySeconds, with a
 * batchDelaySeconds pause after every batchSize messages (the admin portal's pacing settings).
 */
export function spacedSendTimes(count: number, start: Date, delaySeconds: number, batchSize: number, batchDelaySeconds: number): Date[] {
  const times: Date[] = [];
  let t = start.getTime();
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const pause = batchSize > 0 && i % batchSize === 0 ? batchDelaySeconds : delaySeconds;
      t += Math.max(MIN_GAP_MS, pause * 1000);
    }
    times.push(new Date(t));
  }
  return times;
}
