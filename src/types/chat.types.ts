import { ChatSession, ChatMessage } from "@prisma/client";

export interface ChatSessionWithMessages extends ChatSession {
  messages: ChatMessage[];
}

export interface CreateChatSessionInput {
  visitorName: string;
  visitorEmail?: string;
  visitorPhone?: string;
  visitorCountry?: string;
  visitorDevice?: string;
  visitorBrowser?: string;
  source?: string;
  referrer?: string;
  currentPage?: string;
  interestedIn?: string;
  helpWith?: string;
}

export interface AddMessageInput {
  sessionId: string;
  role: "user" | "assistant" | "agent" | "system";
  content: string;
  agentId?: string;
  agentName?: string;
  confidence?: number;
  products?: any;
}
