import dotenv from "dotenv";
dotenv.config();

const OPENWA_API_URL = process.env.OPENWA_API_URL || "https://ai.thewellnesslab.ae/api";
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || "";
const OPENWA_SESSION_ID = process.env.OPENWA_SESSION_ID || "default";

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (OPENWA_API_KEY) {
    headers["Authorization"] = `Bearer ${OPENWA_API_KEY}`;
    headers["X-API-Key"] = OPENWA_API_KEY;
  }
  return headers;
}

async function testMedia(mediaField: "file" | "url") {
  const url = `${OPENWA_API_URL}/sessions/${OPENWA_SESSION_ID}/messages/send-image`;
  
  const payload: any = {
    chatId: "919625534956@c.us",
    caption: `Test media message using field: ${mediaField}`
  };
  payload[mediaField] = "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=500";

  console.log(`Sending POST to: ${url} using ${mediaField}`);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(payload)
    });

    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Response text:", text);
  } catch (error) {
    console.error("Error:", error);
  }
}

async function main() {
  await testMedia("file");
  await testMedia("url");
}

main();
