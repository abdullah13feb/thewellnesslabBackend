// Creates a lead (Lead table) for every existing Wellness Lab WhatsApp contact that has none yet.
// New chats get their lead automatically from the webhook; this covers chats from before that.
//   npx tsx scripts/backfillWhatsappLeads.ts            # dry run, prints what would be created
//   npx tsx scripts/backfillWhatsappLeads.ts --apply    # create the leads
// Safe to re-run: numbers that already have a lead are skipped.
import "dotenv/config";
import prisma from "../src/lib/prisma.js";
import { contactStatusToLead, findWhatsappLead, upsertWhatsappLead } from "../src/lib/whatsappLead.js";

const APPLY = process.argv.includes("--apply");
const OWN_NUMBERS = ["971559206585", "971585865195"];

async function main() {
  const contacts = await prisma.wellnessLabContact.findMany({ orderBy: { createdAt: "asc" } });
  let created = 0;
  let skipped = 0;
  let fromAds = 0;

  for (const c of contacts) {
    if (!c.phoneNumber || OWN_NUMBERS.includes(c.phoneNumber)) continue;
    if (await findWhatsappLead(c.phoneNumber)) {
      skipped++;
      continue;
    }
    const first = await prisma.wellnessLabMessageLog.findFirst({
      where: { phoneNumber: c.phoneNumber, direction: "Incoming" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, messageContent: true, customerName: true },
    });
    const name = c.customerName && c.customerName !== "WhatsApp Customer" ? c.customerName : first?.customerName;
    const fromAd = Boolean(c.ctwaClid);
    if (fromAd) fromAds++;
    created++;
    if (!APPLY) continue;

    const lead = await upsertWhatsappLead({
      phone: c.phoneNumber,
      customerName: name,
      message: first?.messageContent,
      adId: fromAd ? c.adId : "",
      ctwaClid: fromAd ? c.ctwaClid : "",
      at: first?.createdAt || c.createdAt,
    });
    if (lead) {
      const fields = { ...((lead.dynamicFields as any) || {}) };
      if (fromAd && c.ctwaClickedAt) fields["CTWA Clicked At"] = c.ctwaClickedAt.toISOString();
      if (c.notes) fields["Notes"] = c.notes;
      if (c.dealValue) fields["Deal Value (AED)"] = c.dealValue;
      await prisma.lead.update({
        where: { id: lead.id },
        data: { status: contactStatusToLead(c.leadStatus), dynamicFields: fields, email: c.email || undefined, city: c.city || undefined },
      });
    }
  }

  console.log(`${APPLY ? "Created" : "Would create"} ${created} WhatsApp leads (${fromAds} from Click to WhatsApp ads); ${skipped} already had a lead.`);
  if (!APPLY) console.log("Dry run. Re-run with --apply to write.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
