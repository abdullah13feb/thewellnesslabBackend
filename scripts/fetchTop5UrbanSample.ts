import axios from 'axios';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const GOWA_API_URL = process.env.CTWA_GOWA_API_URL || 'http://3.110.175.249:3000';
const DEVICE_ID = process.env.URBAN_SAUNA_DEVICE_ID || 'UrbanSauna';
const AUTH = {
  username: process.env.GOWA_BASIC_USER || 'user1',
  password: process.env.GOWA_BASIC_PASS || 'pass1',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchTop5UrbanSaunaSample() {
  console.log(`🔍 Safely fetching TOP 5 sample chats for Urban Sauna (${DEVICE_ID})...`);

  try {
    const chatsRes = await axios.get(`${GOWA_API_URL}/chats`, {
      headers: { 'X-Device-Id': DEVICE_ID },
      auth: AUTH,
      timeout: 15000,
    });

    const raw = chatsRes.data;
    const allChats = raw?.results?.data || raw?.data || (Array.isArray(raw) ? raw : []);

    const top5Chats = allChats
      .filter((c: any) => c && c.jid && !c.jid.endsWith('@g.us') && c.jid !== 'status@broadcast')
      .slice(0, 5);

    console.log(`📋 Total chats found: ${allChats.length}. Selected top 5 contacts for sample test.`);

    const exportData: any = {
      metadata: {
        device_id: DEVICE_ID,
        gowa_url: GOWA_API_URL,
        exported_at: new Date().toISOString(),
        total_chats_sample: top5Chats.length,
      },
      chats: [],
      messages: [],
    };

    for (let i = 0; i < top5Chats.length; i++) {
      const chat = top5Chats[i];
      const phone = (chat.jid || chat.phone || '').replace(/[^0-9]/g, '');
      if (!phone) continue;

      console.log(`[${i + 1}/${top5Chats.length}] Fetching history for ${chat.name || phone}...`);

      exportData.chats.push({
        jid: chat.jid,
        phoneNumber: phone,
        customerName: chat.name || 'WhatsApp Customer',
        lastMessageTime: chat.last_message_time || new Date().toISOString(),
      });

      try {
        const jidParam = encodeURIComponent(chat.jid || `${phone}@s.whatsapp.net`);
        const historyRes = await axios.get(`${GOWA_API_URL}/chat/${jidParam}/messages?limit=50&offset=0`, {
          headers: { 'X-Device-Id': DEVICE_ID },
          auth: AUTH,
          timeout: 10000,
        });

        const rawMsgs = historyRes.data?.results?.data || historyRes.data?.data || [];
        console.log(`  └─ Fetched ${rawMsgs.length} messages for ${chat.name || phone}`);

        for (const m of rawMsgs) {
          exportData.messages.push({
            id: m.id,
            chat_jid: m.chat_jid || chat.jid,
            phoneNumber: phone,
            customerName: m.sender_display_name || chat.name || 'WhatsApp Customer',
            is_from_me: m.is_from_me || false,
            content: m.content || '',
            media_type: m.media_type || '',
            media_url: m.url || m.media_url || '',
            timestamp: m.timestamp || m.created_at,
          });
        }
      } catch (err: any) {
        console.warn(`⚠️ Could not fetch messages for ${phone}: ${err.message}`);
      }

      await sleep(800);
    }

    const outputPath = path.resolve(process.cwd(), 'urban_sauna_top5_sample.json');
    fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

    console.log(`\n✅ TOP 5 SAMPLE JSON CREATED AT: ${outputPath}`);
  } catch (err: any) {
    console.error('❌ Failed to fetch sample:', err.message);
  }
}

fetchTop5UrbanSaunaSample();
