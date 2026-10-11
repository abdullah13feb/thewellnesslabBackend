import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

async function dumpWellnessLabJsonToDb() {
  console.log('🚀 Step 1: Connecting to Database & ensuring WellnessLabMessageLog table exists...');

  const createTableSql = `
    CREATE TABLE IF NOT EXISTS public."WellnessLabMessageLog" (
      id text NOT NULL,
      timestamp text NOT NULL,
      "phoneNumber" text NOT NULL,
      "customerName" text NULL DEFAULT 'WhatsApp Customer'::text,
      direction text NOT NULL,
      "messageContent" text NOT NULL,
      "mediaUrl" text NULL,
      "mediaType" text NULL,
      "adId" text NOT NULL DEFAULT ''::text,
      "creativeName" text NOT NULL DEFAULT ''::text,
      campaign text NOT NULL DEFAULT ''::text,
      product text NOT NULL DEFAULT ''::text,
      "flowName" text NOT NULL DEFAULT ''::text,
      "nodeId" text NOT NULL DEFAULT ''::text,
      "nodeLabel" text NOT NULL DEFAULT ''::text,
      status text NOT NULL DEFAULT 'Sent'::text,
      "deviceId" text NOT NULL DEFAULT 'adil'::text,
      "createdAt" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "WellnessLabMessageLog_pkey" PRIMARY KEY (id)
    );
  `;

  const createIdx1 = `CREATE INDEX IF NOT EXISTS "WellnessLabMessageLog_createdAt_idx" ON public."WellnessLabMessageLog" USING btree ("createdAt");`;
  const createIdx2 = `CREATE INDEX IF NOT EXISTS "WellnessLabMessageLog_phoneNumber_idx" ON public."WellnessLabMessageLog" USING btree ("phoneNumber");`;

  try {
    await prisma.$executeRawUnsafe(createTableSql);
    await prisma.$executeRawUnsafe(createIdx1);
    await prisma.$executeRawUnsafe(createIdx2);
    console.log('✅ Table public."WellnessLabMessageLog" & indexes verified/created successfully!');
  } catch (err: any) {
    console.error('❌ Failed to create table/indexes:', err.message);
    process.exit(1);
  }

  const jsonPaths = [
    path.resolve(process.cwd(), '../whatsapp_messages_history.json'),
    path.resolve(process.cwd(), 'whatsapp_messages_history.json'),
  ];

  let targetJsonPath = '';
  for (const p of jsonPaths) {
    if (fs.existsSync(p)) {
      targetJsonPath = p;
      break;
    }
  }

  if (!targetJsonPath) {
    console.error('❌ File whatsapp_messages_history.json not found!');
    process.exit(1);
  }

  console.log(`📂 Step 2: Reading whatsapp_messages_history.json from ${targetJsonPath}...`);
  const rawData = fs.readFileSync(targetJsonPath, 'utf-8');
  const data = JSON.parse(rawData);

  const messages = data.messages || [];
  console.log(`📊 Total messages found in JSON file: ${messages.length}`);

  if (messages.length === 0) {
    console.log('⚠️ No messages to dump. Exiting.');
    return;
  }

  console.log('⏳ Step 3: Preparing and dumping messages to public."WellnessLabMessageLog"...');

  let insertedCount = 0;
  const batchSize = 100;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);

    for (const m of batch) {
      const chatJid = m.chat_jid || m.sender_jid || '';
      const rawPhone = m.phoneNumber || chatJid.replace(/[^0-9]/g, '');
      const phoneNumber = rawPhone || '00000000000';

      const msgId = m.id || `gen_${phoneNumber}_${m.timestamp || Date.now()}`;

      let createdAtDate = new Date();
      if (m.timestamp) {
        createdAtDate = new Date(m.timestamp);
      } else if (m.created_at) {
        createdAtDate = new Date(m.created_at);
      }

      if (isNaN(createdAtDate.getTime())) {
        createdAtDate = new Date();
      }

      const timestampStr = m.timestamp_gregorian || m.timestamp || createdAtDate.toISOString();

      const customerName = m.sender_name || m.customerName || 'WhatsApp Customer';
      const direction = m.is_from_me ? 'Outgoing' : 'Incoming';
      const messageContent = m.content || (m.media_type ? `[${m.media_type.toUpperCase()} Media]` : '');
      const mediaUrl = m.media_url || null;
      const mediaType = m.media_type || null;
      const deviceId = m.device_id || data.metadata?.device_id || 'Wellnesslab';

      const insertSql = `
        INSERT INTO public."WellnessLabMessageLog" (
          id, timestamp, "phoneNumber", "customerName", direction, "messageContent",
          "mediaUrl", "mediaType", "adId", "creativeName", campaign, product,
          "flowName", "nodeId", "nodeLabel", status, "deviceId", "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12,
          $13, $14, $15, $16, $17, $18
        )
        ON CONFLICT (id) DO UPDATE SET
          timestamp = EXCLUDED.timestamp,
          "phoneNumber" = EXCLUDED."phoneNumber",
          "customerName" = EXCLUDED."customerName",
          direction = EXCLUDED.direction,
          "messageContent" = EXCLUDED."messageContent",
          "mediaUrl" = EXCLUDED."mediaUrl",
          "mediaType" = EXCLUDED."mediaType",
          "deviceId" = EXCLUDED."deviceId",
          "createdAt" = EXCLUDED."createdAt";
      `;

      try {
        await prisma.$executeRawUnsafe(
          insertSql,
          msgId,
          timestampStr,
          phoneNumber,
          customerName,
          direction,
          messageContent,
          mediaUrl,
          mediaType,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          'Sent',
          deviceId,
          createdAtDate
        );
        insertedCount++;
      } catch (err: any) {
        console.warn(`⚠️ Error inserting message ${msgId}:`, err.message);
      }
    }

    console.log(`   └─ Dumped ${Math.min(i + batchSize, messages.length)}/${messages.length} messages...`);
  }

  console.log('\n====================================================');
  console.log('🎉 DUMP COMPLETE TO TABLE public."WellnessLabMessageLog"!');
  console.log(`💬 Total Messages in JSON: ${messages.length}`);
  console.log(`✅ Total Messages Successfully Dumped to Database: ${insertedCount}`);
  console.log(`📁 Source File: ${targetJsonPath}`);
  console.log('====================================================\n');
}

dumpWellnessLabJsonToDb()
  .catch((err) => console.error('❌ Error executing database dump:', err))
  .finally(() => prisma.$disconnect());
