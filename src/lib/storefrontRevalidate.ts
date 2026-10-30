// Tells the storefront (radiant-aura-labs) to drop its cached product pages, so a price saved in the
// admin portal shows on the next page load. Never throws: a failed call only means the storefront
// falls back to its 300 s refresh.
export async function revalidateStorefront(reason: string): Promise<void> {
  const url = process.env.STOREFRONT_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    console.warn("[storefront] STOREFRONT_REVALIDATE_URL or REVALIDATE_SECRET not set; skipping revalidation");
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error(`[storefront] revalidation failed (${reason}): HTTP ${res.status}`);
    }
  } catch (error) {
    console.error(`[storefront] revalidation failed (${reason}):`, error);
  }
}
