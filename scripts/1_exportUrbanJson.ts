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

// Safe sleep helper with Maximum Stealth random human jitter (4.0s to 5.0s per request for 100% safety)
const getRandomDelay = (minMs = 4000, maxMs = 5000) =>
  Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exportUrbanSaunaJson() {
  console.log(`🔒 Step 1: Safely fetching chats for Urban Sauna (${DEVICE_ID}) from GOWA...`);

  try {
    // 1. Paginate through all /chats pages to retrieve all 647 contacts
    let offset = 0;
    const limit = 100;
    let hasMore = true;
    let allRawChats: any[] = [];

    while (hasMore) {
      console.log(`📡 Fetching contacts list page (offset=${offset}, limit=${limit})...`);
      const chatsRes = await axios.get(`${GOWA_API_URL}/chats?limit=${limit}&offset=${offset}`, {
        headers: { 'X-Device-Id': DEVICE_ID },
        auth: AUTH,
        timeout: 15000,
      });

      const pageData = chatsRes.data?.results?.data || chatsRes.data?.data || [];
      if (!pageData || pageData.length === 0) {
        hasMore = false;
      } else {
        allRawChats = allRawChats.concat(pageData);
        offset += pageData.length;
        const total = chatsRes.data?.results?.pagination?.total || 647;
        if (allRawChats.length >= total || pageData.length < limit) {
          hasMore = false;
        }
      }
    }

    const chatList = allRawChats.filter(
      (c: any) => c && c.jid && !c.jid.endsWith('@g.us') && c.jid !== 'status@broadcast'
    );
    console.log(`📋 Total Contacts Retrieved: ${chatList.length} (out of 647).`);

    const outputPath = path.resolve(process.cwd(), 'urban_sauna_messages_history.json');

    let exportData: any = {
      metadata: {
        device_id: DEVICE_ID,
        gowa_url: GOWA_API_URL,
        exported_at: new Date().toISOString(),
        total_chats: chatList.length,
      },
      chats: [],
      messages: [],
    };

    // Load existing progress if file exists (Resumable Export)
    if (fs.existsSync(outputPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
        if (existing && Array.isArray(existing.chats)) {
          exportData.chats = existing.chats;
          exportData.messages = existing.messages || [];
          console.log(`🔄 Found existing export file! Resuming with ${exportData.chats.length} already-fetched contacts.`);
        }
      } catch (e) {
        console.warn('⚠️ Could not parse existing export file, starting fresh.');
      }
    }

    const fetchedJidsSet = new Set(exportData.chats.map((c: any) => c.jid || c.phoneNumber));

    const MAX_CONTACTS_PER_RUN = 100;
    let fetchedInThisRun = 0;

    // 2. Loop through each contact sequentially with Maximum Stealth delay (4.0s - 5.0s)
    for (let i = 0; i < chatList.length; i++) {
      if (fetchedInThisRun >= MAX_CONTACTS_PER_RUN) {
        console.log(`\n🛑 DAY 1 TARGET REACHED (${MAX_CONTACTS_PER_RUN} contacts fetched in this run). Pausing export safely!`);
        break;
      }

      const chat = chatList[i];
      const phone = (chat.jid || chat.phone || '').replace(/[^0-9]/g, '');
      if (!phone || chat.jid === 'status@broadcast') continue;

      // Skip if already fetched in a previous session
      if (fetchedJidsSet.has(chat.jid) || fetchedJidsSet.has(phone)) {
        console.log(`⏭️  [${i + 1}/${chatList.length}] Already exported ${chat.name || phone}, skipping...`);
        continue;
      }

      console.log(`[Run Count: ${fetchedInThisRun + 1}/${MAX_CONTACTS_PER_RUN}] (${i + 1}/${chatList.length} total) Safely fetching history for ${chat.name || phone}...`);

      exportData.chats.push({
        jid: chat.jid,
        phoneNumber: phone,
        customerName: chat.name || 'WhatsApp Customer',
        lastMessageTime: chat.last_message_time || new Date().toISOString(),
      });
      fetchedJidsSet.add(chat.jid);
      fetchedInThisRun++;

      try {
        // Fetch message thread for this single contact
        const jidParam = encodeURIComponent(chat.jid || `${phone}@s.whatsapp.net`);
        const historyRes = await axios.get(`${GOWA_API_URL}/chat/${jidParam}/messages?limit=100&offset=0`, {
          headers: { 'X-Device-Id': DEVICE_ID },
          auth: AUTH,
          timeout: 10000,
        });

        const rawMsgs = historyRes.data?.results?.data || historyRes.data?.data || [];
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
        console.warn(`⚠️ Skipped messages for ${phone}: ${err.message}`);
      }

      // Save progress incrementally after every contact
      fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));

      // ⏱️ Maximum Stealth Random Human Jitter Delay (4.0s to 5.0s per request)
      const delay = getRandomDelay(4000, 5000);
      await sleep(delay);
    }

    console.log(`\n🎉 STEP 1 COMPLETE FOR THIS RUN! Total Exported so far: ${exportData.chats.length} chats & ${exportData.messages.length} messages.`);
    console.log(`👉 Progress saved in: ${outputPath}\n`);
  } catch (err: any) {
    console.error('❌ Failed to fetch Urban Sauna history:', err.message);
  }
}

exportUrbanSaunaJson();
