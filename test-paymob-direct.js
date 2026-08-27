import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const PAYMOB_PRIVATE_KEY = (process.env.PAYMOB_PRIVATE_API_KEY || "").trim();
const PAYMOB_API_KEY = (process.env.PAYMOB_API_KEY || "").trim();

async function testFetchIntegrations() {
  console.log("=== FETCHING INTEGRATIONS LIST ===");

  const urls = [
    "https://uae.paymob.com/api/acceptance/payment_integrations",
    "https://accept.paymob.com/api/acceptance/payment_integrations",
    "https://uae.paymob.com/v1/intention/integrations",
    "https://accept.paymob.com/v1/intention/integrations"
  ];

  for (const url of urls) {
    try {
      console.log(`Trying ${url}...`);
      const res = await axios.get(url, {
        headers: {
          Authorization: `Token ${PAYMOB_PRIVATE_KEY}`,
          "Content-Type": "application/json"
        }
      });
      console.log("🎉 FOUND INTEGRATIONS!", JSON.stringify(res.data, null, 2));
      return res.data;
    } catch (err) {
      console.log(`❌ Failed ${url}: Status ${err.response?.status}`, err.response?.data || err.message);
    }
  }
}

testFetchIntegrations();
