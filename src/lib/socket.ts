import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import prisma from "./prisma.js";
import chatAiService from "../services/chat-ai.service.js";

let io: Server;

// Keep track of online agents
const onlineAgents = new Set<string>();

export function initSocketServer(httpServer: HttpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: "*", // Permissive for development/testing
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true
    }
  });

  io.on("connection", (socket: Socket) => {
    // ────────────── CLIENT JOIN ──────────────
    socket.on("customer:join", async ({ sessionId }) => {
      if (!sessionId) return;
      socket.join(sessionId);
      
      // Update session activity or check status
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: { messages: { orderBy: { createdAt: "asc" } } }
      });
      
      if (session) {
        socket.emit("session:state", {
          status: session.status,
          leadScore: session.leadScore,
          agentName: session.agentName,
          messages: session.messages
        });
      }
    });

    // ────────────── CLIENT MESSAGE ──────────────
    socket.on("customer:message", async ({ sessionId, content }) => {
      if (!sessionId || !content) return;

      try {
        // 1. Fetch current session state
        let session = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: { messages: { orderBy: { createdAt: "asc" } } }
        });

        if (!session) return;

        // 2. Save user message to database
        const userMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "user",
            content
          }
        });

        // Broadcast user's message to everyone in the room (including agent tabs)
        io.to(sessionId).emit("message:new", userMsg);

        // 3. Update active session pages / duration
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() }
        });

        // 4. Check for automatic human handoff triggers
        const triggerHandoff = chatAiService.shouldHandoff(content);
        if (triggerHandoff && session.status === "BOT") {
          session = await prisma.chatSession.update({
            where: { id: sessionId },
            data: { status: "WAITING" },
            include: { messages: { orderBy: { createdAt: "asc" } } }
          });
          io.to(sessionId).emit("session:status_changed", { status: "WAITING" });
          io.emit("agent:session_alert", { sessionId, visitorName: session.visitorName, type: "handoff_request" });

          // Send system warning message to chat
          const sysMsg = await prisma.chatMessage.create({
            data: {
              sessionId,
              role: "system",
              content: "Transferring conversation to a CRM agent. Please wait..."
            }
          });
          io.to(sessionId).emit("message:new", sysMsg);
        }

        // 5. If BOT mode, generate AI response
        if (session.status === "BOT") {
          // Send typing indicator to customer
          io.to(sessionId).emit("typing:state", { role: "assistant", isTyping: true });

          // Format previous conversation context for AI
          const messageHistory = session.messages.map(m => ({
            role: m.role === "user" ? "user" : "assistant",
            content: m.content
          }));
          messageHistory.push({ role: "user", content });

          // Generate AI response
          const aiResponse = await chatAiService.generateResponse(session, messageHistory);

          // Turn off typing indicator
          io.to(sessionId).emit("typing:state", { role: "assistant", isTyping: false });

          // Save AI message
          const aiMsg = await prisma.chatMessage.create({
            data: {
              sessionId,
              role: "assistant",
              content: aiResponse.content,
              confidence: aiResponse.confidence,
              products: aiResponse.recommendedProducts as any
            }
          });

          io.to(sessionId).emit("message:new", aiMsg);

          // Update lead score dynamically
          const updatedHistory = [...messageHistory, { role: "assistant", content: aiResponse.content }];
          const leadScoreDetails = await chatAiService.classifyLead(updatedHistory);
          
          const uniqueProducts = Array.from(new Set([
            ...session.productsDiscussed,
            ...aiResponse.recommendedProducts
          ]));

          await prisma.chatSession.update({
            where: { id: sessionId },
            data: {
              leadScore: leadScoreDetails.leadScore,
              leadScoreNum: leadScoreDetails.leadScoreNum,
              productsDiscussed: uniqueProducts
            }
          });

          // Check if AI response has low confidence, triggers offline handoff
          if (aiResponse.confidence < 0.4) {
            await prisma.chatSession.update({
              where: { id: sessionId },
              data: { status: "WAITING" }
            });
            io.to(sessionId).emit("session:status_changed", { status: "WAITING" });
            io.emit("agent:session_alert", { sessionId, visitorName: session.visitorName, type: "low_confidence" });

            const sysMsg = await prisma.chatMessage.create({
              data: {
                sessionId,
                role: "system",
                content: "AI confidence is low. Handing over to our team. An agent will be with you shortly."
              }
            });
            io.to(sessionId).emit("message:new", sysMsg);
          }
        } else if (session.status === "WAITING") {
          // Alert agents again that customer is waiting and just messaged
          io.emit("agent:session_alert", { sessionId, visitorName: session.visitorName, type: "customer_message" });
        }

      } catch (error) {
        console.error("[Socket] Error handling customer message:", error);
      }
    });

    // ────────────── AGENT JOIN / AUTH ──────────────
    socket.on("agent:online", async ({ clerkId, name }) => {
      if (!clerkId) return;
      socket.join("agents_room");
      onlineAgents.add(clerkId);

      // Create/update agent presence
      await prisma.chatAgent.upsert({
        where: { clerkId },
        create: { clerkId, name, isOnline: true, lastSeenAt: new Date() },
        update: { name, isOnline: true, lastSeenAt: new Date() }
      });

      io.emit("agent:presence_changed", { clerkId, isOnline: true });
    });

    // ────────────── AGENT TAKEOVER (JOIN CONVERSATION) ──────────────
    socket.on("agent:takeover", async ({ sessionId, agentId, agentName }) => {
      if (!sessionId || !agentId) return;

      try {
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session) return;

        // Generate summary before agent joins
        const fullSession = await prisma.chatSession.findUnique({
          where: { id: sessionId },
          include: { messages: { orderBy: { createdAt: "asc" } } }
        });
        
        let summaryFields = {};
        if (fullSession) {
          const summaryInfo = await chatAiService.generateSummary(fullSession);
          summaryFields = {
            aiSummary: summaryInfo.aiSummary,
            aiIntent: summaryInfo.aiIntent,
            aiAction: summaryInfo.aiAction
          };
        }

        // Update status to AGENT
        const updatedSession = await prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            status: "AGENT",
            agentId,
            agentName,
            ...summaryFields
          }
        });

        // Broadcast status change to room
        io.to(sessionId).emit("session:status_changed", {
          status: "AGENT",
          agentName,
          ...summaryFields
        });

        // Insert System Message "Sarah Ahmed has joined the conversation"
        const sysMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "system",
            content: `👤 ${agentName} (Sales Consultant) has joined the conversation.`
          }
        });

        io.to(sessionId).emit("message:new", sysMsg);
        
        // Notify all agents so their listings update
        io.emit("agent:session_updated", { sessionId, status: "AGENT", agentId, agentName });

      } catch (error) {
        console.error("[Socket] Takeover error:", error);
      }
    });

    // ────────────── AGENT MESSAGE ──────────────
    socket.on("agent:message", async ({ sessionId, agentId, agentName, content }) => {
      if (!sessionId || !content) return;

      try {
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session || session.status !== "AGENT") return;

        const agentMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "agent",
            content,
            agentId,
            agentName
          }
        });

        // Broadcast to customer & agent
        io.to(sessionId).emit("message:new", agentMsg);
        
        // Update session timestamp
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { updatedAt: new Date() }
        });

      } catch (error) {
        console.error("[Socket] Agent message error:", error);
      }
    });

    // ────────────── HANDBACK TO BOT (TOGGLE MODE) ──────────────
    socket.on("agent:handback", async ({ sessionId }) => {
      if (!sessionId) return;

      try {
        const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
        if (!session) return;

        await prisma.chatSession.update({
          where: { id: sessionId },
          data: {
            status: "BOT",
            agentId: null,
            agentName: null
          }
        });

        io.to(sessionId).emit("session:status_changed", {
          status: "BOT",
          agentName: null
        });

        const sysMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "system",
            content: "🔄 Conversation handed back to AI Assistant."
          }
        });

        io.to(sessionId).emit("message:new", sysMsg);
        io.emit("agent:session_updated", { sessionId, status: "BOT", agentId: null, agentName: null });

      } catch (error) {
        console.error("[Socket] Handback error:", error);
      }
    });

    // ────────────── CLOSE CONVERSATION ──────────────
    socket.on("agent:close", async ({ sessionId }) => {
      if (!sessionId) return;

      try {
        await prisma.chatSession.update({
          where: { id: sessionId },
          data: { status: "CLOSED" }
        });

        io.to(sessionId).emit("session:status_changed", { status: "CLOSED" });

        const sysMsg = await prisma.chatMessage.create({
          data: {
            sessionId,
            role: "system",
            content: "🏁 Conversation closed by agent."
          }
        });

        io.to(sessionId).emit("message:new", sysMsg);
        io.emit("agent:session_updated", { sessionId, status: "CLOSED" });

      } catch (error) {
        console.error("[Socket] Close session error:", error);
      }
    });

    // ────────────── TYPING INDICATOR ──────────────
    socket.on("typing:submit", ({ sessionId, role, isTyping }) => {
      if (!sessionId) return;
      socket.to(sessionId).emit("typing:state", { role, isTyping });
    });

    // ────────────── DISCONNECT ──────────────
    socket.on("disconnect", () => {
      // Find and set disconnected agents to offline
      // Typically we'd map socket.id to clerkId. Let's do a simple cleanup on disconnect.
    });
  });
}

export { io };
