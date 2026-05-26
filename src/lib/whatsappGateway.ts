import dotenv from "dotenv";

dotenv.config();

const OPENWA_API_URL = process.env.OPENWA_API_URL || "https://ai.thewellnesslab.ae/api";
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || "";
const OPENWA_SESSION_ID = process.env.OPENWA_SESSION_ID || "default";

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

/**
 * Normalizes phone numbers to a clean format: e.g. 971501234567.
 * Appends @c.us if requested.
 */
export function normalizePhoneNumber(phone: string, appendSuffix = true): string {
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
  
  if (appendSuffix && !cleaned.endsWith("@c.us")) {
    cleaned = `${cleaned}@c.us`;
  }
  
  return cleaned;
}

/**
 * Send a text message to a specific number using OpenWA
 */
export async function sendWhatsappMessage(
  sessionId: string,
  toPhone: string,
  text: string
): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const formattedPhone = normalizePhoneNumber(toPhone);
  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/send-text`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        chatId: formattedPhone,
        text: text,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenWA Error response (${response.status}):`, errorText);
      return false;
    }

    const data = await response.json();
    return !!data;
  } catch (error) {
    console.error("Error in sendWhatsappMessage:", error);
    return false;
  }
}

/**
 * Fetch all sessions from the OpenWA server
 */
export async function getSessionsList(): Promise<any[]> {
  const url = `${OPENWA_API_URL}/sessions`;
  try {
    const response = await fetch(url, { headers: getHeaders() });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error in getSessionsList:", error);
    return [];
  }
}

/**
 * Get detailed status of a specific session
 */
export async function getSessionStatus(sessionId: string): Promise<any> {
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
    console.error("Error in getSessionStatus:", error);
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
    return false;
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
    console.error("Error in stopSession:", error);
    return false;
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
    console.error("Error in deleteSession:", error);
    return false;
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
    console.error("Error in getSessionQR:", error);
    return null;
  }
}

/**
 * Send an image, video, or document using OpenWA media endpoints
 */
export async function sendWhatsappMediaMessage(
  sessionId: string,
  toPhone: string,
  text: string,
  mediaUrl: string,
  mediaType: string
): Promise<boolean> {
  const finalSessionId = getFinalSessionId(sessionId);
  const formattedPhone = normalizePhoneNumber(toPhone);
  
  let endpoint = "send-image";
  const bodyData: Record<string, any> = {
    chatId: formattedPhone,
    file: mediaUrl,
    filename: mediaUrl.split("/").pop() || "file",
  };

  if (mediaType === "VIDEO") {
    endpoint = "send-video";
    bodyData.caption = text;
  } else if (mediaType === "DOCUMENT") {
    endpoint = "send-document";
    bodyData.caption = text;
    bodyData.title = text;
  } else {
    // IMAGE
    endpoint = "send-image";
    bodyData.caption = text;
  }

  const url = `${OPENWA_API_URL}/sessions/${finalSessionId}/messages/${endpoint}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify(bodyData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenWA Media Error response (${response.status}):`, errorText);
      return false;
    }

    const data = await response.json();
    return !!data;
  } catch (error) {
    console.error("Error in sendWhatsappMediaMessage:", error);
    return false;
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


