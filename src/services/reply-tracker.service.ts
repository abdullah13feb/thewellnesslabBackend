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
      const searchCriteria: any = { seen: false };
      const messages = await client.search(searchCriteria);

      if (messages && messages.length > 0) {
        console.log(`[Reply Tracker] Found ${messages.length} unseen messages for ${account.email}`);

        // Fetch envelopes and raw source to parse headers/body
        for await (const msg of client.fetch(messages as number[], { envelope: true, source: true })) {
          const fromAddress = msg.envelope?.from?.[0]?.address || '';
          const subject = msg.envelope?.subject || '';
          
          let bodyText = '';
          try {
            if (msg.source) {
              const parsed = await simpleParser(msg.source);
              bodyText = parsed.text || '';
            }
          } catch (parseErr) {
            console.error('[Reply Tracker] Failed to parse raw email body:', parseErr);
          }

          const combinedContent = (subject + ' ' + bodyText).toLowerCase();

          // Check if this is a bounce notification or a spam complaint
          const isBounceSender = fromAddress.toLowerCase().includes('mailer-daemon') ||
                                 fromAddress.toLowerCase().includes('postmaster') ||
                                 fromAddress.toLowerCase().includes('bounce');
          
          const isBounceSubject = combinedContent.includes('delivery failure') ||
                                  combinedContent.includes('delivery status notification') ||
                                  combinedContent.includes('undeliverable') ||
                                  combinedContent.includes('returned mail') ||
                                  combinedContent.includes('failure notice') ||
                                  combinedContent.includes('returned to sender');

          const isSpamComplaint = combinedContent.includes('spam complaint') ||
                                  combinedContent.includes('feedback loop') ||
                                  combinedContent.includes('unsolicited') ||
                                  combinedContent.includes('blocked');

          if (isBounceSender || isBounceSubject || isSpamComplaint) {
            console.log(`[Reply Tracker] Processing bounce/spam email from: ${fromAddress}`);

            // Find all email addresses in the email body to locate which recipient bounced
            const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emailsInBody = bodyText.match(emailRegex) || [];
            
            let matchedRecipient = null;

            for (const email of emailsInBody) {
              if (email.toLowerCase() === account.email.toLowerCase()) continue;

              const rec = await prisma.emailCampaignRecipient.findFirst({
                where: {
                  email: email,
                  status: 'SENT',
                  senderAccountId: account.id
                },
                orderBy: {
                  sentAt: 'desc'
                }
              });

              if (rec) {
                matchedRecipient = rec;
                break;
              }
            }

            if (matchedRecipient) {
              if (isSpamComplaint) {
                console.log(`[Reply Tracker] Spam complaint matched: ${matchedRecipient.email}`);
                await prisma.$transaction([
                  prisma.emailCampaignRecipient.update({
                    where: { id: matchedRecipient.id },
                    data: { 
                      status: 'SPAM', 
                      spamReportedAt: new Date(),
                      error: 'Spam complaint / block detected via IMAP inbox'
                    }
                  }),
                  prisma.emailCampaign.update({
                    where: { id: matchedRecipient.campaignId },
                    data: { spamCount: { increment: 1 } }
                  })
                ]);
              } else {
                console.log(`[Reply Tracker] Bounce delivery failure matched: ${matchedRecipient.email}`);
                await prisma.$transaction([
                  prisma.emailCampaignRecipient.update({
                    where: { id: matchedRecipient.id },
                    data: { 
                      status: 'BOUNCED', 
                      bouncedAt: new Date(),
                      error: 'Bounce delivery failure detected via IMAP inbox'
                    }
                  }),
                  prisma.emailCampaign.update({
                    where: { id: matchedRecipient.campaignId },
                    data: { bounceCount: { increment: 1 } }
                  })
                ]);
              }
            } else {
              console.log(`[Reply Tracker] Bounce/spam sender parsed but no matching recipient found in body`);
            }
          } else if (fromAddress) {
            console.log(`[Reply Tracker] Processing email reply from ${fromAddress}`);

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
