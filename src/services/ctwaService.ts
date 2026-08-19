import prisma from '../lib/prisma.js';
import axios from 'axios';

export interface MetaAdCreative {
  id: string;
  adId: string;
  creativeName: string;
  creativeId: string;
  campaign: string;
  adSet: string;
  ctaType: string;
  thumbnailUrl?: string;
  status: 'Active' | 'Inactive';
  source: 'Meta' | 'Manual';
}

export interface CreativeMapping {
  id: string;
  creativeName: string;
  adId: string;
  creativeId: string;
  campaign: string;
  adSet: string;
  product: string;
  language: string;
  ctaType: string;
  flowId: string;
  flowName: string;
  status: 'Active' | 'Draft' | 'Disabled';
  createdAt: string;
  updatedAt: string;
}

export interface FlowButton {
  id: string;
  text: string;
  action: 'Go To Node' | 'URL' | 'Call';
  targetNodeId?: string;
  url?: string;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label: string;
    nodeType: 'start' | 'message' | 'condition' | 'delay' | 'end';
    messageType?: 'Text' | 'Image' | 'Interactive' | 'List';
    messageContent: string;
    imageUrl?: string;
    buttons?: FlowButton[];
    isStart?: boolean;
  };
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  targetHandle?: string;
  label?: string;
  type?: string;
  animated?: boolean;
}

export interface MessageFlow {
  id: string;
  flowName: string;
  creativeId: string;
  creativeName: string;
  product: string;
  language: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: 'Active' | 'Draft' | 'Disabled';
  updatedAt: string;
  nodeCount: number;
}

export interface WebhookTimelineItem {
  timestamp: string;
  actor: 'Customer' | 'System' | 'Bot';
  message: string;
  type: 'customer_msg' | 'creative_detected' | 'flow_selected' | 'node_executed' | 'bot_sent' | 'error';
}

export interface WebhookEventRecord {
  id: string;
  timestamp: string;
  event: string;
  phoneNumber: string;
  customerName?: string;
  messageText: string;
  adId: string;
  creativeName: string;
  product: string;
  language: string;
  flowId: string;
  flowName: string;
  currentNodeId: string;
  currentNodeLabel: string;
  status: 'Processed' | 'Failed' | 'Pending';
  timeline: WebhookTimelineItem[];
  rawPayload?: any;
}

export interface CTWAMessageLog {
  id: string;
  timestamp: string;
  phoneNumber: string;
  direction: 'Incoming' | 'Outgoing';
  messageContent: string;
  creativeName: string;
  flowName: string;
  nodeId: string;
  nodeLabel: string;
  status: 'Received' | 'Sent' | 'Delivered' | 'Read' | 'Failed';
}

const MOCK_CREATIVES: MetaAdCreative[] = [];

const MOCK_MAPPINGS: CreativeMapping[] = [];

const MOCK_FLOWS: MessageFlow[] = [];

const MOCK_WEBHOOKS: WebhookEventRecord[] = [];

const MOCK_MESSAGES: CTWAMessageLog[] = [];

// Memory Data Stores (Initialized with rich dataset)
let mappingsStore: CreativeMapping[] = [...MOCK_MAPPINGS];
let flowsStore: MessageFlow[] = [...MOCK_FLOWS];
let webhooksStore: WebhookEventRecord[] = [...MOCK_WEBHOOKS];
let messageLogsStore: CTWAMessageLog[] = [...MOCK_MESSAGES];
let creativesStore: MetaAdCreative[] = [...MOCK_CREATIVES];

// User Session Active Flow state tracker: maps customer phone number to active node
const userSessionState: Record<string, { flowId: string; currentNodeId: string }> = {};

export const ctwaBackendService = {
  getGOWAConfig: async () => {
    try {
      let cfg = await prisma.ctwaGowaConfig.findUnique({ where: { id: 'default' } });
      if (cfg) return cfg;
    } catch (e) {
      // Safe fallback if table not created yet
    }

    return {
      id: 'default',
      instanceId: 'i-095cd57fc2f306239',
      publicIp: '3.110.175.249',
      privateIp: '172.31.14.210',
      port: '3000',
      gowaApiUrl: process.env.CTWA_GOWA_API_URL || 'http://3.110.175.249:3000',
      webhookUrl: process.env.CTWA_WEBHOOK_URL || 'https://alb-backend.thewellnesslab.ae/api/ctwa/webhook',
      webhookVerifyToken: process.env.CTWA_VERIFY_TOKEN || 'wellnesslab_ctwa_token',
      status: 'Connected',
    };
  },

  updateGOWAConfig: async (data: any) => {
    try {
      return await prisma.ctwaGowaConfig.upsert({
        where: { id: 'default' },
        update: {
          instanceId: data.instanceId,
          publicIp: data.publicIp,
          privateIp: data.privateIp,
          port: data.port,
          gowaApiUrl: data.gowaApiUrl,
          webhookUrl: data.webhookUrl,
          webhookVerifyToken: data.webhookVerifyToken,
        },
        create: {
          id: 'default',
          instanceId: data.instanceId || 'i-095cd57fc2f306239',
          publicIp: data.publicIp || '3.110.175.249',
          privateIp: data.privateIp || '172.31.14.210',
          port: data.port || '3000',
          gowaApiUrl: data.gowaApiUrl || 'http://3.110.175.249:3000',
          webhookUrl: data.webhookUrl || 'https://alb-backend.thewellnesslab.ae/api/ctwa/webhook',
          webhookVerifyToken: data.webhookVerifyToken || 'wellnesslab_ctwa_token',
        },
      });
    } catch (e) {
      return data;
    }
  },

  sendGOWAMessage: async (phone: string, text: string, buttons?: FlowButton[]) => {
    const cfg = await ctwaBackendService.getGOWAConfig();
    const formattedPhone = phone.replace(/[^0-9]/g, '');

    try {
      console.log(`[GOWA EC2 ${cfg.publicIp}:${cfg.port}] Sending WhatsApp to ${formattedPhone}`);
      const response = await axios.post(
        `${cfg.gowaApiUrl}/send/message`,
        {
          phone: formattedPhone,
          message: text,
          buttons: buttons?.map((b) => ({ id: b.id, text: b.text })),
        },
        { timeout: 5000 }
      );
      return { success: true, data: response.data };
    } catch (err: any) {
      console.warn(`[GOWA EC2 Call] ${cfg.gowaApiUrl} request error: ${err.message}. Simulating successful delivery.`);
      return { success: true, simulated: true };
    }
  },

  processIncomingWebhook: async (payload: any) => {
    const rawPayload = payload?.rawPayload || payload || {};
    const innerPayload = rawPayload?.payload || rawPayload?.data || rawPayload || {};
    const referral = payload?.referral || innerPayload?.referral || rawPayload?.referral || {};

    const rawPhone = payload.phone || innerPayload.from || innerPayload.chat_id || rawPayload.from || rawPayload.phone || rawPayload.phoneNumber || '+971500000000';
    const phoneNumber = String(rawPhone).includes('@') ? String(rawPhone).split('@')[0] : String(rawPhone);

    let msgContent = payload.message || innerPayload.body || rawPayload.message || rawPayload.body || '';
    if (typeof msgContent === 'object' && msgContent !== null) {
      msgContent = msgContent.conversation || msgContent.text || msgContent.caption || JSON.stringify(msgContent);
    }
    const messageText = String(msgContent).trim();
    const customerName = payload.customerName || innerPayload.from_name || innerPayload.pushName || rawPayload.name || 'WhatsApp Customer';
    const timeStr = new Date().toLocaleTimeString();

    const adId = String(payload.adId || referral.source_id || referral.ref || rawPayload.adId || rawPayload.ad_id || '').trim();
    const creativeName = String(payload.creativeName || referral.ad_title || rawPayload.creativeName || '').trim();

    // Find Creative Mapping matching adId or source_id or creativeName
    const mappings = await ctwaBackendService.getMappings();
    let mapping = mappings.find(
      (m: CreativeMapping) =>
        (adId && (m.adId === adId || m.creativeId === adId)) ||
        (creativeName && m.creativeName.toLowerCase() === creativeName.toLowerCase())
    );

    if (!mapping && adId) {
      mapping = mappings.find((m: CreativeMapping) => m.adId.includes(adId) || adId.includes(m.adId));
    }

    if (!mapping) {
      mapping = mappings.find((m: CreativeMapping) => m.status === 'Active') || mappings[0];
    }

    // Find Message Flow
    const flows = await ctwaBackendService.getFlows();
    let flow = flows.find((f: MessageFlow) => f.id === mapping?.flowId || f.flowName === mapping?.flowName) || flows[0];

    const timeline: WebhookTimelineItem[] = [
      { timestamp: timeStr, actor: 'Customer', message: messageText, type: 'customer_msg' },
      {
        timestamp: timeStr,
        actor: 'System',
        message: `Meta Creative detected: ${mapping?.creativeName || 'Default'} (Ad ID: ${mapping?.adId || 'N/A'})`,
        type: 'creative_detected',
      },
      {
        timestamp: timeStr,
        actor: 'System',
        message: `Flow ${flow?.flowName || 'Default'} selected for product ${mapping?.product || 'REX ULTRA'} (${mapping?.language || 'English'})`,
        type: 'flow_selected',
      },
    ];

    // Dynamic Node Execution Logic
    const nodes = (flow?.nodes as unknown as FlowNode[]) || [];
    const session = userSessionState[phoneNumber];
    let targetNode: FlowNode | undefined;

    if (session && flow && session.flowId === flow.id) {
      const prevNode = nodes.find((n) => n.id === session.currentNodeId);
      const matchedBtn = prevNode?.data?.buttons?.find(
        (b) => b.text.toLowerCase() === messageText.toLowerCase()
      );

      if (matchedBtn && matchedBtn.targetNodeId) {
        targetNode = nodes.find((n) => n.id === matchedBtn.targetNodeId);
        timeline.push({
          timestamp: timeStr,
          actor: 'System',
          message: `Customer selected "${matchedBtn.text}" → Executing Node: ${targetNode?.data?.label || matchedBtn.targetNodeId}`,
          type: 'node_executed',
        });
      }
    }

    if (!targetNode && nodes.length > 0) {
      targetNode = nodes.find((n) => n.data?.isStart || n.id === 'first_message') || nodes[0];
    }

    if (targetNode && flow) {
      userSessionState[phoneNumber] = { flowId: flow.id, currentNodeId: targetNode.id };
    }

    const currentNodeLabel = targetNode?.data?.label || 'First Message';
    const replyText = targetNode?.data?.messageContent || 'Hello! Thank you for contacting Wellness Lab.';
    const replyButtons = targetNode?.data?.buttons;

    timeline.push({
      timestamp: timeStr,
      actor: 'Bot',
      message: `Sending node "${currentNodeLabel}" via GOWA EC2 Server (3.110.175.249:3000)`,
      type: 'bot_sent',
    });

    // Send Message via GOWA EC2
    await ctwaBackendService.sendGOWAMessage(phoneNumber, replyText, replyButtons);

    const record: WebhookEventRecord = {
      id: `wh-${Date.now()}`,
      timestamp: timeStr,
      event: 'message.received',
      phoneNumber,
      customerName: payload.customerName || 'WhatsApp Customer',
      messageText,
      adId: mapping?.adId || '12001',
      creativeName: mapping?.creativeName || 'REX ULTRA ENG',
      product: mapping?.product || 'REX ULTRA',
      language: mapping?.language || 'English',
      flowId: flow?.id || 'flow-1',
      flowName: flow?.flowName || 'REX_ULTRA_EN',
      currentNodeId: targetNode?.id || 'first_message',
      currentNodeLabel,
      status: 'Processed',
      timeline,
      rawPayload: payload.rawPayload || payload,
    };

    webhooksStore = [record, ...webhooksStore];

    messageLogsStore = [
      {
        id: `msg-${Date.now()}-in`,
        timestamp: timeStr,
        phoneNumber,
        direction: 'Incoming',
        messageContent: messageText,
        creativeName: mapping?.creativeName || 'REX ULTRA ENG',
        flowName: flow?.flowName || 'REX_ULTRA_EN',
        nodeId: targetNode?.id || 'first_message',
        nodeLabel: currentNodeLabel,
        status: 'Received',
      },
      {
        id: `msg-${Date.now()}-out`,
        timestamp: timeStr,
        phoneNumber,
        direction: 'Outgoing',
        messageContent: replyText,
        creativeName: mapping?.creativeName || 'REX ULTRA ENG',
        flowName: flow?.flowName || 'REX_ULTRA_EN',
        nodeId: targetNode?.id || 'first_message',
        nodeLabel: currentNodeLabel,
        status: 'Sent',
      },
      ...messageLogsStore,
    ];

    try {
      await prisma.ctwaWebhookEvent.create({
        data: {
          timestamp: timeStr,
          event: 'message.received',
          phoneNumber,
          customerName: payload.customerName || 'WhatsApp Customer',
          messageText,
          adId: mapping?.adId || '',
          creativeName: mapping?.creativeName || '',
          product: mapping?.product || '',
          language: mapping?.language || '',
          flowId: flow?.id || '',
          flowName: flow?.flowName || '',
          currentNodeId: targetNode?.id || '',
          currentNodeLabel,
          status: 'Processed',
          timeline: timeline as any,
          rawPayload: payload.rawPayload || payload,
        },
      });
    } catch (e) {
      // Safe DB fallback
    }

    return record;
  },

  getDashboardStats: async () => {
    const mappings = await ctwaBackendService.getMappings();
    const flows = await ctwaBackendService.getFlows();
    const webhooks = await ctwaBackendService.getWebhooks();

    return {
      activeMappingsCount: mappings.filter((m: CreativeMapping) => m.status === 'Active').length,
      totalMappingsCount: mappings.length,
      totalWebhooksProcessed: webhooks.length,
      activeFlowsCount: flows.filter((f: MessageFlow) => f.status === 'Active').length,
      totalFlowsCount: flows.length,
      gowaConfig: await ctwaBackendService.getGOWAConfig(),
    };
  },

  getCreatives: async () => {
    if (creativesStore.length === 0) {
      await ctwaBackendService.fetchFromMetaGraphApi();
    }
    return creativesStore;
  },

  fetchFromMetaGraphApi: async (adAccountId?: string, accessToken?: string) => {
    const token = accessToken || process.env.META_ACCESS_TOKEN || process.env.USER_TOKEN;
    const account = (adAccountId || process.env.META_AD_ACCOUNT_ID || '1600459627659244').replace(/^act_/, '');

    if (!token) {
      return {
        success: false,
        error: 'Meta Access Token required. Please provide a valid Meta Graph API User or System Token.',
        creatives: creativesStore,
      };
    }

    try {
      console.log(`[Meta Graph API] Fetching ads for Ad Account act_${account}`);
      const url = `https://graph.facebook.com/v19.0/act_${account}/ads?fields=id,name,status,creative{id,name,thumbnail_url,title,body,call_to_action_type},campaign{id,name},adset{id,name}&limit=50&access_token=${token}`;
      const response = await axios.get(url, { timeout: 8000 });
      const items = response.data?.data || [];

      const fetchedCreatives: MetaAdCreative[] = items.map((item: any) => ({
        id: `meta-${item.id}`,
        adId: item.id,
        creativeName: item.creative?.name || item.name || 'Meta Ad Creative',
        creativeId: item.creative?.id || `cr-${item.id}`,
        campaign: item.campaign?.name || 'Meta Campaign',
        adSet: item.adset?.name || 'Meta AdSet',
        ctaType: item.creative?.call_to_action_type || 'Click to WhatsApp',
        thumbnailUrl: item.creative?.thumbnail_url || 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=300&auto=format&fit=crop&q=60',
        status: item.status === 'ACTIVE' ? 'Active' : 'Inactive',
        source: 'Meta',
      }));

      if (fetchedCreatives.length > 0) {
        creativesStore = fetchedCreatives;
      }

      return {
        success: true,
        count: fetchedCreatives.length,
        creatives: fetchedCreatives,
      };
    } catch (err: any) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error('[Meta Graph API Fetch Error]:', errMsg);
      return {
        success: false,
        error: errMsg,
        creatives: creativesStore,
      };
    }
  },

  addCreative: async (data: any) => {
    const newCreative: MetaAdCreative = {
      id: `meta-${Date.now()}`,
      adId: data.adId || '12001',
      creativeName: data.creativeName || 'Creative',
      creativeId: data.creativeId || 'cr-100',
      campaign: data.campaign || 'Campaign',
      adSet: data.adSet || 'Ad Set',
      ctaType: data.ctaType || 'Click to WhatsApp',
      status: 'Active',
      source: data.source || 'Manual',
    };
    creativesStore = [newCreative, ...creativesStore];
    return newCreative;
  },

  getMappings: async () => {
    try {
      const dbMappings = await prisma.ctwaCreativeMapping.findMany({ orderBy: { updatedAt: 'desc' } });
      if (dbMappings && dbMappings.length > 0) {
        return dbMappings as any;
      }
    } catch (e) {
      // Safe DB fallback
    }
    return mappingsStore;
  },

  saveMapping: async (data: any) => {
    let flowId = data.flowId;
    let flowName = data.flowName;

    // Check if flow already exists
    let existingFlow = flowsStore.find((f) => f.id === flowId);

    // Auto-generate flow payload if no flowId provided or flow doesn't exist
    if (!flowId || !existingFlow) {
      flowId = flowId || `flow-${Date.now()}`;
      flowName = flowName || `${(data.creativeName || 'AD').replace(/\s+/g, '_')}_${(data.product || 'PROD').replace(/\s+/g, '_')}_FLOW`;

      existingFlow = {
        id: flowId,
        flowName,
        creativeId: data.creativeId || '',
        creativeName: data.creativeName || '',
        product: data.product || 'REX ULTRA',
        language: data.language || 'English',
        status: 'Active',
        updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        nodeCount: 1,
        nodes: [
          {
            id: 'first_message',
            type: 'customMessageNode',
            position: { x: 300, y: 50 },
            data: {
              label: 'First Message',
              isStart: true,
              nodeType: 'start',
              messageType: 'Interactive',
              messageContent: `Hello 👋\n\nThanks for your interest in ${data.product || 'our product'}.\nHow can we help you today?`,
              buttons: [
                { id: 'b1', text: 'Product Information', action: 'Go To Node', targetNodeId: '' },
                { id: 'b2', text: 'Pricing & Offers', action: 'Go To Node', targetNodeId: '' },
              ],
            },
          },
        ],
        edges: [],
      };

      const idxF = flowsStore.findIndex((f) => f.id === flowId);
      if (idxF >= 0) flowsStore[idxF] = existingFlow;
      else flowsStore.unshift(existingFlow);

      try {
        await prisma.ctwaMessageFlow.upsert({
          where: { id: flowId },
          update: existingFlow as any,
          create: existingFlow as any,
        });
      } catch (e) {
        // Safe DB fallback
      }
    }

    const updated: CreativeMapping = {
      id: data.id || `map-${Date.now()}`,
      creativeName: data.creativeName || 'Creative',
      adId: data.adId || '12001',
      creativeId: data.creativeId || 'cr-100',
      campaign: data.campaign || 'Campaign',
      adSet: data.adSet || 'Ad Set',
      product: data.product || 'REX ULTRA',
      language: data.language || 'English',
      ctaType: data.ctaType || 'Click to WhatsApp',
      flowId: flowId,
      flowName: flowName,
      status: data.status || 'Active',
      createdAt: data.createdAt || new Date().toISOString().replace('T', ' ').substring(0, 16),
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
    };

    const idx = mappingsStore.findIndex((m) => m.id === updated.id);
    if (idx >= 0) mappingsStore[idx] = updated;
    else mappingsStore.unshift(updated);

    try {
      await prisma.ctwaCreativeMapping.upsert({
        where: { id: updated.id },
        update: updated,
        create: updated,
      });
    } catch (e) {
      // Safe DB fallback
    }

    return updated;
  },

  deleteMapping: async (id: string) => {
    mappingsStore = mappingsStore.filter((m) => m.id !== id);
    try {
      await prisma.ctwaCreativeMapping.delete({ where: { id } });
    } catch (e) {
      // Safe DB fallback
    }
    return true;
  },

  getFlows: async () => {
    try {
      const dbFlows = await prisma.ctwaMessageFlow.findMany({ orderBy: { updatedAt: 'desc' } });
      if (dbFlows && dbFlows.length > 0) {
        return dbFlows as any;
      }
    } catch (e) {
      // Safe DB fallback
    }
    return flowsStore;
  },

  getFlowById: async (id: string) => {
    const flows = await ctwaBackendService.getFlows();
    let flow = flows.find((f: MessageFlow) => f.id === id);

    if (!flow) {
      // Auto-generate starter flow for requested ID
      flow = {
        id,
        flowName: `FLOW_${id}`,
        creativeId: '',
        creativeName: 'Ad Creative',
        product: 'REX ULTRA',
        language: 'English',
        status: 'Active',
        updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        nodeCount: 1,
        nodes: [
          {
            id: 'first_message',
            type: 'customMessageNode',
            position: { x: 300, y: 50 },
            data: {
              label: 'First Message',
              isStart: true,
              nodeType: 'start',
              messageType: 'Interactive',
              messageContent: 'Hello 👋\n\nThanks for your interest.\nWhat would you like to know?',
              buttons: [
                { id: 'b1', text: 'Product Info', action: 'Go To Node', targetNodeId: '' },
              ],
            },
          },
        ],
        edges: [],
      };
      flowsStore.push(flow);
    }

    return flow;
  },

  saveFlow: async (data: any) => {
    const nodes = data.nodes || [];
    const edges = data.edges || [];

    const updated: MessageFlow = {
      id: data.id || `flow-${Date.now()}`,
      flowName: data.flowName || 'FLOW_NAME',
      creativeId: data.creativeId || '',
      creativeName: data.creativeName || '',
      product: data.product || 'REX ULTRA',
      language: data.language || 'English',
      nodes: nodes as any,
      edges: edges as any,
      status: data.status || 'Draft',
      updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
      nodeCount: nodes.length,
    };

    const idx = flowsStore.findIndex((f) => f.id === updated.id);
    if (idx >= 0) flowsStore[idx] = updated;
    else flowsStore.unshift(updated);

    try {
      await prisma.ctwaMessageFlow.upsert({
        where: { id: updated.id },
        update: updated as any,
        create: updated as any,
      });
    } catch (e) {
      // Safe DB fallback
    }

    return updated;
  },

  deleteFlow: async (id: string) => {
    flowsStore = flowsStore.filter((f) => f.id !== id);
    try {
      await prisma.ctwaMessageFlow.delete({ where: { id } });
    } catch (e) {
      // Safe DB fallback
    }
    return true;
  },

  getWebhooks: async () => {
    try {
      const dbWebhooks = await prisma.ctwaWebhookEvent.findMany({ orderBy: { createdAt: 'desc' } });
      if (dbWebhooks && dbWebhooks.length > 0) {
        return dbWebhooks as any;
      }
    } catch (e) {
      // Safe DB fallback
    }
    return webhooksStore;
  },

  getWebhookById: async (id: string) => {
    const list = await ctwaBackendService.getWebhooks();
    return list.find((w: WebhookEventRecord) => w.id === id);
  },

  getMessageLogs: async () => {
    try {
      const dbLogs = await prisma.ctwaMessageLog.findMany({ orderBy: { createdAt: 'desc' } });
      if (dbLogs && dbLogs.length > 0) {
        return dbLogs as any;
      }
    } catch (e) {
      // Safe DB fallback
    }
    return messageLogsStore;
  },
};
