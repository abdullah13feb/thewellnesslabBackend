import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient();

async function dumpUrbanJsonToDb() {
  const jsonPath = path.resolve(process.cwd(), 'urban_sauna_messages_history.json');

  console.log(`📂 Step 2: Reading JSON file from ${jsonPath}...`);

  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ File not found: ${jsonPath}. Please run Step 1 script first!`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(rawData);

  const chats = data.chats || [];
  const messages = data.messages || [];

  console.log(`Found ${chats.length} contacts and ${messages.length} messages in JSON file.`);

  // 1. Upsert Contacts into UrbanSaunaContact table
  console.log('⏳ Upserting contacts into UrbanSaunaContact table...');
  for (const c of chats) {
    const phoneNumber = c.phoneNumber || c.jid?.replace(/[^0-9]/g, '');
    if (!phoneNumber) continue;

    await prisma.urbanSaunaContact.upsert({
      where: { phoneNumber },
      update: {
        customerName: c.customerName && c.customerName !== phoneNumber ? c.customerName : undefined,
      },
      create: {
        phoneNumber,
        customerName: c.customerName && c.customerName !== phoneNumber ? c.customerName : 'WhatsApp Customer',
        leadStatus: 'NEW_LEAD',
        tags: ['History Import'],
      },
    });
  }
  console.log('✅ Contacts upserted successfully.');

  // 2. Batch insert messages into UrbanSaunaMessageLog table
  console.log('⏳ Inserting messages into UrbanSaunaMessageLog table...');
  const messageLogs = messages.map((m: any) => {
    const phoneNumber = m.phoneNumber || m.chat_jid?.replace(/[^0-9]/g, '');
    const createdAtDate = m.timestamp ? new Date(m.timestamp) : new Date();

    const timeStr = createdAtDate.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Dubai',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    return {
      phoneNumber,
      customerName: m.customerName || 'WhatsApp Customer',
      direction: m.is_from_me ? 'Outgoing' : 'Incoming',
      messageContent: m.content || (m.media_type ? `[${m.media_type.toUpperCase()} Media]` : ''),
      mediaUrl: m.media_url || null,
      mediaType: m.media_type || null,
      status: 'Logged',
      deviceId: 'UrbanSauna',
      timestamp: timeStr,
      createdAt: createdAtDate,
    };
  });

  // 2. Fetch existing DB message logs to prevent duplicates with live webhooks
  console.log('⏳ Checking existing database logs to prevent duplicates with live webhooks...');
  const existingDbLogs = await prisma.urbanSaunaMessageLog.findMany({
    select: { phoneNumber: true, messageContent: true, createdAt: true },
  });

  const existingKeySet = new Set(
    existingDbLogs.map(
      (l) => `${l.phoneNumber}_${l.messageContent.trim()}_${new Date(l.createdAt).getTime()}`
    )
  );

  const newMessagesToInsert = messageLogs.filter((m: any) => {
    const key = `${m.phoneNumber}_${m.messageContent.trim()}_${new Date(m.createdAt).getTime()}`;
    return !existingKeySet.has(key);
  });

  console.log(`📊 Total messages in JSON: ${messageLogs.length}. New unique messages to insert: ${newMessagesToInsert.length} (Skipped ${messageLogs.length - newMessagesToInsert.length} already in DB).`);

  // Batch insert in chunks of 100
  const batchSize = 100;
  for (let i = 0; i < newMessagesToInsert.length; i += batchSize) {
    const chunk = newMessagesToInsert.slice(i, i + batchSize);
    await prisma.urbanSaunaMessageLog.createMany({
      data: chunk,
      skipDuplicates: true,
    });
  }

  console.log(`\n🎉 STEP 2 COMPLETE! Successfully dumped ${chats.length} contacts and ${messageLogs.length} messages into database!\n`);
}

dumpUrbanJsonToDb()
  .catch((err) => console.error('❌ Error dumping JSON to DB:', err))
  .finally(() => prisma.$disconnect());
