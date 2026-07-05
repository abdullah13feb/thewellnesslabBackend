import { Router } from "express";
import prisma from "../lib/prisma.js";
import { requireAdminOrApiKey, requireAuthOrApiKey } from "../middleware/auth.js";
import chatKnowledgeService from "../services/chat-knowledge.service.js";
import chatAiService from "../services/chat-ai.service.js";
import { io } from "../lib/socket.js";
import axios from "axios";

const router = Router();

// 1. Create or resume chat session (Public)
router.post("/session", async (req, res) => {
  try {
    const {
      visitorName,
      visitorEmail,
      visitorPhone,
      visitorCountry,
      visitorDevice,
      visitorBrowser,
      source,
      referrer,
      currentPage,
      interestedIn,
      helpWith
    } = req.body;

    if (!visitorName) {
      return res.status(400).json({ success: false, error: "Visitor name is required" });
    }

    // Determine visitor country using client IP address dynamically
    let detectedCountry = visitorCountry || "UAE";
    try {
      const clientIp = (req.headers["x-forwarded-for"] as string || req.socket.remoteAddress || "").split(",")[0].trim();
      if (clientIp && !clientIp.includes("127.0.0.1") && clientIp !== "::1" && !clientIp.startsWith("fe80")) {
        const geoRes = await axios.get(`http://ip-api.com/json/${clientIp}`);
        if (geoRes.data && geoRes.data.status === "success") {
          detectedCountry = geoRes.data.country || detectedCountry;
        }
      }
    } catch (e) {
      console.error("Failed to lookup country from IP:", e);
    }

    // A. Check if there is an existing Lead with the same email/phone in CRM
    let linkedLead = null;
    if (visitorEmail) {
      linkedLead = await prisma.lead.findFirst({
        where: { email: visitorEmail }
      });
    }

    // B. Create a new CRM Lead if it doesn't exist
    if (!linkedLead) {
      linkedLead = await prisma.lead.create({
        data: {
          name: visitorName,
          email: visitorEmail || null,
          phone: visitorPhone || null,
          source: source || "Website Chat",
          city: detectedCountry || null,
          status: "NEW",
          dynamicFields: {
            interestedIn: interestedIn || null,
            helpWith: helpWith || null
          }
        }
      });
    } else {
      // Update existing lead status or fields if necessary
      await prisma.lead.update({
        where: { id: linkedLead.id },
        data: {
          phone: visitorPhone || linkedLead.phone,
          city: detectedCountry || linkedLead.city,
          dynamicFields: {
            ...(linkedLead.dynamicFields as object),
            interestedIn: interestedIn || null,
            helpWith: helpWith || null
          }
        }
      });
    }

    // C. Create the ChatSession in the database
    const session = await prisma.chatSession.create({
      data: {
        visitorName,
        visitorEmail: visitorEmail || null,
        visitorPhone: visitorPhone || null,
        visitorCountry: detectedCountry || null,
        visitorDevice: visitorDevice || null,
        visitorBrowser: visitorBrowser || null,
        source: source || null,
        referrer: referrer || null,
        currentPage: currentPage || null,
        interestedIn: interestedIn || null,
        helpWith: helpWith || null,
        leadId: linkedLead.id,
        status: "BOT",
        leadScore: "COLD",
        leadScoreNum: 10
      }
    });

    // D. Add first welcome message as standard
    const welcomeMsg = await prisma.chatMessage.create({
      data: {
        sessionId: session.id,
        role: "assistant",
        content: `👋 Welcome to The Wellness Lab, ${visitorName}! I'm your AI Product Assistant. I can help you choose the right product, answer your questions, or connect you with our sales team. Let me know what you'd like to ask!`
      }
    });

    res.status(201).json({
      success: true,
      data: {
        session,
        welcomeMessage: welcomeMsg
      }
    });
  } catch (error: any) {
    console.error("Error creating chat session:", error);
    res.status(500).json({ success: false, error: "Internal Server Error", details: error.message });
  }
});

// 2. Resume session by ID (Public)
router.get("/session/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const session = await prisma.chatSession.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } }
    });

    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    res.json({ success: true, data: session });
  } catch (error: any) {
    res.status(500).json({ success: false, error: "Internal Server Error", details: error.message });
  }
});

// 3. Get all sessions for CRM Agent Dashboard (Admin Protected)
router.get("/sessions", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const { status } = req.query;
    const where: any = {};
    if (status) {
      where.status = status as string;
    }

    const sessions = await prisma.chatSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    res.json({ success: true, data: sessions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: "Internal Server Error", details: error.message });
  }
});

// 4. Force AI Knowledge Base Reindexing (Admin Protected)
router.post("/knowledge/reindex", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const result = await chatKnowledgeService.reindex();
    if (result.success) {
      res.json({ success: true, message: `Reindexed successfully. Total chunks: ${result.count}` });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 5. Get Analytics Data (Admin Protected)
router.get("/analytics/summary", requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
  try {
    const totalSessions = await prisma.chatSession.count();
    
    // Resolution vs Handoff
    const botSessionsCount = await prisma.chatSession.count({ where: { status: "BOT" } });
    const agentSessionsCount = await prisma.chatSession.count({ where: { status: "AGENT" } });
    const waitingSessionsCount = await prisma.chatSession.count({ where: { status: "WAITING" } });
    const closedSessionsCount = await prisma.chatSession.count({ where: { status: "CLOSED" } });

    // Lead Scoring Distribution
    const hotLeads = await prisma.chatSession.count({ where: { leadScore: "HOT" } });
    const warmLeads = await prisma.chatSession.count({ where: { leadScore: "WARM" } });
    const coldLeads = await prisma.chatSession.count({ where: { leadScore: "COLD" } });

    // Open Rate, Start Rate: Mock/calculated based on sessions vs visits if visits table existed, or general ratios
    const totalVisits = await prisma.visitBusiness.count(); // fallback metric

    // AI Resolution Rate: Sessions that remained BOT or CLOSED without agent assigned
    const resolvedByAiCount = await prisma.chatSession.count({
      where: {
        agentId: null,
        status: { in: ["BOT", "CLOSED"] }
      }
    });

    const aiResolutionRate = totalSessions > 0 ? Math.round((resolvedByAiCount / totalSessions) * 100) : 100;
    const handoffRate = totalSessions > 0 ? Math.round(((agentSessionsCount + waitingSessionsCount) / totalSessions) * 100) : 0;

    // Fetch popular products mentioned
    const sessions = await prisma.chatSession.findMany({
      select: { productsDiscussed: true, interestedIn: true, source: true }
    });

    const productCounts: Record<string, number> = {};
    const intentCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};

    sessions.forEach(s => {
      s.productsDiscussed.forEach(p => {
        productCounts[p] = (productCounts[p] || 0) + 1;
      });
      if (s.interestedIn) {
        intentCounts[s.interestedIn] = (intentCounts[s.interestedIn] || 0) + 1;
      }
      if (s.source) {
        sourceCounts[s.source] = (sourceCounts[s.source] || 0) + 1;
      }
    });

    res.json({
      success: true,
      data: {
        counters: {
          totalVisitors: totalVisits || totalSessions * 10,
          chatOpenRate: totalVisits > 0 ? Math.round((totalSessions / totalVisits) * 100) : 35,
          chatStartRate: 85,
          aiResolutionRate,
          humanHandoffRate: handoffRate,
          totalSessions,
          qualifiedLeads: hotLeads + warmLeads,
          hotLeads,
          warmLeads,
          coldLeads
        },
        distributions: {
          status: { BOT: botSessionsCount, WAITING: waitingSessionsCount, AGENT: agentSessionsCount, CLOSED: closedSessionsCount },
          products: Object.entries(productCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5),
          intents: Object.entries(intentCounts).map(([name, value]) => ({ name, value })),
          sources: Object.entries(sourceCounts).map(([name, value]) => ({ name, value }))
        }
      }
    });
  } catch (error: any) {
    console.error("Analytics fetch failed:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
