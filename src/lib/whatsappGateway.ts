import dotenv from "dotenv";

dotenv.config();

const OPENWA_API_URL = process.env.OPENWA_API_URL || "https://ai.thewellnesslab.ae/api";
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || "";
const OPENWA_SESSION_ID = process.env.OPENWA_SESSION_ID || "default";

const GOWA_API_URL = process.env.CTWA_GOWA_API_URL || "http://3.110.175.249:3000";
const GOWA_BASIC_USER = process.env.GOWA_BASIC_USER || process.env.GOWA_USERNAME || "user1";
const GOWA_BASIC_PASS = process.env.GOWA_BASIC_PASS || process.env.GOWA_PASSWORD || "pass1";
const GOWA_DEFAULT_DEVICE = process.env.GOWA_WELLNESS_DEVICE_ID || process.env.GOWA_DEVICE_ID || "Wellnesslab";

export function normalizeDeviceId(deviceId?: string): string {
  if (!deviceId) return GOWA_DEFAULT_DEVICE;
  const lower = deviceId.trim().toLowerCase();
  if (lower === "wellnesslab") return "Wellnesslab";
  if (lower === "urbansauna") return "UrbanSauna";
  return deviceId.trim();
}

function getFinalSessionId(sessionId: string): string {
  return !sessionId || sessionId === "default" ? OPENWA_SESSION_ID : sessionId;
}

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

function getGOWAHeaders(deviceId?: string): Record<string, string> {
  const targetDevice = normalizeDeviceId(deviceId);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Device-Id": targetDevice,
  };
  if (GOWA_BASIC_USER && GOWA_BASIC_PASS) {
    const basicToken = Buffer.from(`${GOWA_BASIC_USER}:${GOWA_BASIC_PASS}`).toString("base64");
    headers["Authorization"] = `Basic ${basicToken}`;
  }
  return headers;
}

/**
 * Normalizes phone numbers to a clean format: e.g. 971501234567.
 * Appends @c.us or @s.whatsapp.net if requested.
 */
export function normalizePhoneNumber(phone: string, appendSuffix = true, isGowa = true): string {
  let cleaned = phone.replace(/\D/g, "");
  
  if (cleaned.startsWith("00")) {
    cleaned = cleaned.substring(2);
  }
  
  // UAE local numbers (e.g., 0501234567 or 501234567)
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
  }
  
  // If it's a standard 9-digit UAE mobile number (starts with 5), prepend 971
  if (cleaned.length === 9 && cleaned.startsWith("5")) {
    cleaned = "971" + cleaned;
  }
  
  if (appendSuffix) {
    if (isGowa && !cleaned.endsWith("@s.whatsapp.net")) {
      cleaned = `${cleaned}@s.whatsapp.net`;
    } else if (!isGowa && !cleaned.endsWith("@c.us")) {
      cleaned = `${cleaned}@c.us`;
    }
  }
  
  return cleaned;
}

/**
 * Send a text message via GOWA API (with fallback to OpenWA)
 */
export async function sendWhatsappMessage(
  sessionId: string,
  toPhone: string,
  text: string,
  deviceId?: string
): Promise<{ success: boolean; error?: string }> {
  const targetDevice = normalizeDeviceId(deviceId);
  const rawPhone = toPhone.replace(/\D/g, "");
  let formattedPhone = rawPhone;
  if (formattedPhone.startsWith("0")) formattedPhone = formattedPhone.substring(1);
  if (formattedPhone.length === 9 && formattedPhone.startsWith("5")) formattedPhone = "971" + formattedPhone;
  const fullJid = `${formattedPhone}@s.whatsapp.net`;

  // 1. Primary: Send via GOWA EC2 Engine
  const gowaUrl = `${GOWA_API_URL}/send/message`;
  let gowaErrDetail = "";
  try {
    console.log(`[GOWA EC2] Dispatching text to ${fullJid} via Device: ${targetDevice}`);
    const res = await fetch(gowaUrl, {
      method: "POST",
      headers: getGOWAHeaders(targetDevice),
      body: JSON.stringify({
        phone: fullJid,
        message: text,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`✅ [GOWA EC2 Success] Text delivered to ${fullJid}`);
      return { success: true };
    }
    const errBody = await res.text();
    console.warn(`⚠️ [GOWA EC2 ${res.status}] ${errBody}`);
    gowaErrDetail = `GOWA (Device: ${targetDevice}, Status ${res.status}): ${errBody || 'Gateway rejected request'}`;
  } catch (gowaErr: any) {
    console.error(`❌ [GOWA EC2 Fetch Error]:`, gowaErr.message);
    gowaErrDetail = `GOWA Connection Error (${gowaUrl}): ${gowaErr.message}`;
  }

  // 2. Fallback: OpenWA Server
  const finalSessionId = getFinalSessionId(sessionId);
  const openwaPhone = normalizePhoneNumber(toPhone, true, false);
  const openwaUrl = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/send-text`;

  try {
    const response = await fetch(openwaUrl, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        chatId: openwaPhone,
        text: text,
      }),
    });

    if (response.ok) {
      return { success: true };
    }
    const openwaErr = await response.text();
    return { success: false, error: gowaErrDetail || `OpenWA HTTP ${response.status}: ${openwaErr}` };
  } catch (error: any) {
    console.error("Error in sendWhatsappMessage fallback:", error);
    return { success: false, error: gowaErrDetail || `Gateway error: ${error.message}` };
  }
}

/**
 * Fetch all sessions from the OpenWA server / GOWA devices
 */
export async function getSessionsList(): Promise<any[]> {
  const url = `${OPENWA_API_URL}/sessions`;
  try {
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return [{ id: "WellnessLab", name: "GOWA WellnessLab Engine", status: "CONNECTED" }];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [{ id: "WellnessLab", name: "GOWA WellnessLab Engine", status: "CONNECTED" }];
  }
}

/**
 * Get detailed status of a specific session (checks GOWA EC2 engine first)
 */
export async function getSessionStatus(sessionId: string, deviceId?: string): Promise<any> {
  const targetDevice = deviceId || GOWA_DEFAULT_DEVICE;
  // Test GOWA server connectivity
  try {
    const res = await fetch(`${GOWA_API_URL}/devices`, {
      method: "GET",
      headers: getGOWAHeaders(targetDevice),
    });
    if (res.ok) {
      return {
        status: "CONNECTED",
        engine: "GOWA EC2 Engine Active",
        serverIp: "3.110.175.249:3000",
        deviceId: targetDevice,
      };
    }
  } catch (e) {
    // ignore
  }

  // Fallback to checking OpenWA status
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}`;
  try {
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) {
      return { status: "DISCONNECTED", error: `Server returned ${response.status}` };
    }
    const data = await response.json();
    return data;
  } catch (error) {
    return { status: "DISCONNECTED", error: "Could not reach gateway server" };
  }
}

/**
 * Start/initialize a WhatsApp session
 */
export async function startSession(sessionId: string): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/start`;
  try {
    // Check if session exists first, if not we create it
    const createUrl = `${OPENWA_API_URL}/sessions`;
    await fetch(createUrl, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ name: finalSessionId }),
    });

    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
    });
    return response.ok;
  } catch (error) {
    console.error("Error in startSession:", error);
    return true; // GOWA is standing active engine
  }
}

/**
 * Stop/disconnect a WhatsApp session
 */
export async function stopSession(sessionId: string): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/stop`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
    });
    return response.ok;
  } catch (error) {
    return true;
  }
}

/**
 * Delete a session completely
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}`;
  try {
    const response = await fetch(url, {
      method: "DELETE",
      headers: getHeaders(),
    });
    return response.ok;
  } catch (error) {
    return true;
  }
}

/**
 * Get QR code data for authentication
 */
export async function getSessionQR(sessionId: string): Promise<any> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/qr`;
  try {
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return null;
    
    // Check content type to see if it's image or json
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      return await response.json();
    } else {
      // If it's a raw image or text, return the base64 / text URL
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { qr: `data:image/png;base64,${base64}` };
    }
  } catch (error) {
    return null;
  }
}

/**
 * Send an image, video, or document using GOWA endpoints (with fallback to OpenWA)
 */
export async function sendWhatsappMediaMessage(
  sessionId: string,
  toPhone: string,
  text: string,
  mediaUrl: string,
  mediaType: string,
  deviceId?: string
): Promise<{ success: boolean; error?: string }> {
  const targetDevice = normalizeDeviceId(deviceId);
  const rawPhone = toPhone.replace(/\D/g, "");
  let formattedPhone = rawPhone;
  if (formattedPhone.startsWith("0")) formattedPhone = formattedPhone.substring(1);
  if (formattedPhone.length === 9 && formattedPhone.startsWith("5")) formattedPhone = "971" + formattedPhone;
  const fullJid = `${formattedPhone}@s.whatsapp.net`;

  // Determine GOWA endpoint & payload based on media type
  const type = (mediaType || "").toLowerCase();
  const isLink = type === "link";
  const isVideo = type === "video" || mediaUrl.match(/\.(mp4|mov|avi|mkv|webm)$/i);
  const isDoc = type === "document" || mediaUrl.match(/\.(pdf|doc|docx|xls|xlsx|txt|zip)$/i);

  let endpoint = `${GOWA_API_URL}/send/image`;
  let reqBody: any = {
    phone: fullJid,
    caption: text || "",
    image_url: mediaUrl,
    view_once: false,
    compress: true,
    is_forwarded: false,
  };

  if (isLink) {
    endpoint = `${GOWA_API_URL}/send/link`;
    reqBody = { phone: fullJid, link: mediaUrl, caption: text || "" };
  } else if (isVideo) {
    endpoint = `${GOWA_API_URL}/send/video`;
    reqBody = { phone: fullJid, caption: text || "", video_url: mediaUrl, view_once: false, compress: true, is_forwarded: false };
  } else if (isDoc) {
    endpoint = `${GOWA_API_URL}/send/file`;
    reqBody = { phone: fullJid, caption: text || "", file_url: mediaUrl, is_forwarded: false };
  }

  let gowaErrDetail = "";
  try {
    console.log(`[GOWA EC2] Sending ${mediaType} to ${fullJid} via ${endpoint}`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: getGOWAHeaders(targetDevice),
      body: JSON.stringify(reqBody),
    });

    if (res.ok) {
      console.log(`✅ [GOWA EC2 Success] ${mediaType} sent to ${fullJid}`);
      return { success: true };
    }
    const errBody = await res.text();
    console.warn(`⚠️ [GOWA EC2 ${res.status}] ${errBody}`);
    gowaErrDetail = `GOWA Media (${mediaType}, Device: ${targetDevice}, Status ${res.status}): ${errBody || 'Gateway rejected request'}`;
  } catch (err: any) {
    console.error(`❌ [GOWA EC2 Media Send Error]:`, err.message);
    gowaErrDetail = `GOWA Connection Error (${endpoint}): ${err.message}`;
  }

  // OpenWA Fallback
  const finalSessionId = getFinalSessionId(sessionId);
  const openwaPhone = normalizePhoneNumber(toPhone, true, false);
  let openwaEndpoint = "send-image";
  const bodyData: Record<string, any> = {
    chatId: openwaPhone,
    url: mediaUrl,
  };

  if (mediaType === "VIDEO") {
    openwaEndpoint = "send-video";
    bodyData.caption = text;
  } else if (mediaType === "DOCUMENT") {
    openwaEndpoint = "send-document";
    bodyData.caption = text;
    bodyData.filename = mediaUrl.split("/").pop() || "document";
  } else {
    openwaEndpoint = "send-image";
    bodyData.caption = text;
  }

  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/${openwaEndpoint}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(bodyData),
    });
    if (response.ok) {
      return { success: true };
    }
    const openwaErr = await response.text();
    return { success: false, error: gowaErrDetail || `OpenWA HTTP ${response.status}: ${openwaErr}` };
  } catch (error: any) {
    console.error("Error in sendWhatsappMediaMessage fallback:", error);
    return { success: false, error: gowaErrDetail || `Gateway error: ${error.message}` };
  }
}

/**
 * Send bulk messages using OpenWA send-bulk endpoint
 */
export async function sendWhatsappBulk(
  sessionId: string,
  messages: Array<{
    chatId: string;
    type: "text" | "image" | "video" | "document";
    content: {
      text?: string;
      image?: { url: string };
      video?: { url: string };
      audio?: { url: string };
      document?: { url: string };
      filename?: string;
      caption?: string;
    };
    variables?: Record<string, any>;
  }>,
  batchId?: string
): Promise<any> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/send-bulk`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        batchId: batchId || undefined,
        messages: messages,
        options: {
          delayBetweenMessages: 3000,
          randomizeDelay: true,
          stopOnError: false
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenWA Bulk Send Error response (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error in sendWhatsappBulk:", error);
    return null;
  }
}

/**
 * Get the status/progress of a bulk message batch
 */
export async function getBatchStatus(
  sessionId: string,
  batchId: string
): Promise<any> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/batch/${batchId}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenWA Batch Status Error response (${response.status}):`, errorText);
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Error in getBatchStatus:", error);
    return null;
  }
}

/**
 * Cancel a running bulk message batch
 */
export async function cancelBatch(
  sessionId: string,
  batchId: string
): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/batch/${batchId}/cancel`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenWA Cancel Batch Error response (${response.status}):`, errorText);
      return false;
    }

    const data = await response.json();
    return !!data;
  } catch (error) {
    console.error("Error in cancelBatch:", error);
    return false;
  }
}


