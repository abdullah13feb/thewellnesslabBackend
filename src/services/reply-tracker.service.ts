import { PrismaClient, EmailSenderAccount } from '@prisma/client';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const prisma = new PrismaClient();

// Keep track of active IMAP connections
const activeClients: Map<string, ImapFlow> = new Map();

/**
 * Connect to an IMAP account and fetch new (UNSEEN) emails
 */
async function processAccountReplies(account: EmailSenderAccount) {
  try {
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapPort === 993,
      auth: {
        user: account.email,
        pass: account.password,
      },
      logger: false // Disable verbose logging
    });

    await client.connect();

    // Select the inbox
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Search for UNSEEN messages
      // We only want to process new replies
      const searchCriteria = { unseen: true };
      const messages = await client.search(searchCriteria);

      if (messages.length > 0) {
        console.log(`[Reply Tracker] Found ${messages.length} unseen messages for ${account.email}`);

        // Fetch envelopes to get sender email
        for await (const msg of client.fetch(messages, { envelope: true })) {
          const fromAddress = msg.envelope.from?.[0]?.address;

          if (fromAddress) {
            console.log(`[Reply Tracker] Processing email from ${fromAddress}`);

            // Find if this person was sent an email recently
            // We order by sentAt DESC to match the most recent campaign sent to them
            const recipientRecord = await prisma.emailCampaignRecipient.findFirst({
              where: {
                email: fromAddress,
                status: 'SENT',
                senderAccountId: account.id
              },
              orderBy: {
                sentAt: 'desc'
              }
            });

            if (recipientRecord) {
              console.log(`[Reply Tracker] Match found! Updating reply status for campaign ${recipientRecord.campaignId}`);

              // If it's the first reply, update repliedAt and increment campaign count
              if (!recipientRecord.repliedAt) {
                await prisma.$transaction([
                  prisma.emailCampaignRecipient.update({
                    where: { id: recipientRecord.id },
                    data: { repliedAt: new Date() }
                  }),
                  prisma.emailCampaign.update({
                    where: { id: recipientRecord.campaignId },
                    data: { replyCount: { increment: 1 } }
                  })
                ]);
              }
            } else {
              console.log(`[Reply Tracker] No sent record found for ${fromAddress}`);
            }
          }

          // Mark message as SEEN so we don't process it again
          await client.messageFlagsAdd(msg.seq, ['\\Seen']);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (error) {
    console.error(`[Reply Tracker] Error processing account ${account.email}:`, error);
  }
}

/**
 * Main loop: fetches all active accounts and processes them sequentially
 */
export async function startReplyTracker() {
  console.log('[Reply Tracker] Engine started...');
  
  // Run every 5 minutes
  setInterval(async () => {
    try {
      const activeAccounts = await prisma.emailSenderAccount.findMany({
        where: { isActive: true }
      });

      for (const account of activeAccounts) {
        await processAccountReplies(account);
      }
    } catch (err) {
      console.error('[Reply Tracker] Global error:', err);
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Also run immediately on startup
  try {
    const activeAccounts = await prisma.emailSenderAccount.findMany({
      where: { isActive: true }
    });
    for (const account of activeAccounts) {
      await processAccountReplies(account);
    }
  } catch (err) {
    console.error('[Reply Tracker] Global error:', err);
  }
}
