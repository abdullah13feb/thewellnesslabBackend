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
      enableDefaultFallback: true,
      defaultFlowId: '',
      defaultFlowName: '',
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
          enableDefaultFallback: data.enableDefaultFallback ?? false,
          defaultFlowId: data.defaultFlowId || '',
          defaultFlowName: data.defaultFlowName || '',
        } as any,
        create: {
          id: 'default',
          instanceId: data.instanceId || 'i-095cd57fc2f306239',
          publicIp: data.publicIp || '3.110.175.249',
          privateIp: data.privateIp || '172.31.14.210',
          port: data.port || '3000',
          gowaApiUrl: data.gowaApiUrl || 'http://3.110.175.249:3000',
          webhookUrl: data.webhookUrl || 'https://alb-backend.thewellnesslab.ae/api/ctwa/webhook',
          webhookVerifyToken: data.webhookVerifyToken || 'wellnesslab_ctwa_token',
          enableDefaultFallback: data.enableDefaultFallback ?? false,
          defaultFlowId: data.defaultFlowId || '',
          defaultFlowName: data.defaultFlowName || '',
        } as any,
      });
    } catch (e) {
      return data;
    }
  },

  sendGOWAMessage: async (phone: string, text: string, buttons?: FlowButton[]) => {
    const cfg = await ctwaBackendService.getGOWAConfig();
    const formattedPhone = phone.replace(/[^0-9]/g, '');

    let finalMessage = text;
    if (buttons && buttons.length > 0) {
      const buttonOptions = buttons.map((b, i) => `${i + 1}️⃣ ${b.text}`).join('\n');
      finalMessage = `${text}\n\n${buttonOptions}\n\n_Reply with option number or text_`;
    }

    const authUser = process.env.GOWA_BASIC_USER || process.env.GOWA_USERNAME || 'user1';
    const authPass = process.env.GOWA_BASIC_PASS || process.env.GOWA_PASSWORD || 'pass1';
    const deviceId = process.env.GOWA_DEVICE_ID || process.env.GOWA_SESSION_ID || process.env.SESSION_ID || 'adil';

    const reqConfig: any = {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Id': deviceId,
      },
    };
    if (authUser && authPass) {
      reqConfig.auth = { username: authUser, password: authPass };
    }

    try {
      console.log(`[GOWA EC2 ${cfg.publicIp}:${cfg.port}] Sending WhatsApp to ${formattedPhone}`);
      const response = await axios.post(
        `${cfg.gowaApiUrl}/send/message`,
        {
          phone: formattedPhone.includes('@') ? formattedPhone : `${formattedPhone}@s.whatsapp.net`,
          message: finalMessage,
          buttons: buttons?.map((b) => ({ id: b.id, text: b.text })),
        },
        reqConfig
      );
      return { success: true, data: response.data };
    } catch (err: any) {
      console.error(`❌ [GOWA EC2 Call Error]: ${cfg.gowaApiUrl}/send/message failed: ${err.message}`);
      return { success: false, error: err.message };
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

    let flow: MessageFlow | undefined;
    const flows = await ctwaBackendService.getFlows();

    if (mapping) {
      flow = flows.find((f: MessageFlow) => f.id === mapping?.flowId || f.flowName === mapping?.flowName);
    }

    if (innerPayload.is_from_me) {
      console.log('ℹ️ [CTWA Webhook] Outgoing message sent by Human Agent (is_from_me: true). Logging to Supabase...');
      let lastLog = await prisma.ctwaMessageLog.findFirst({
        where: { phoneNumber },
        orderBy: { createdAt: 'desc' },
      });

      try {
        await prisma.ctwaMessageLog.create({
          data: {
            timestamp: timeStr,
            phoneNumber,
            customerName: customerName !== 'WhatsApp Customer' ? customerName : lastLog?.customerName || 'WhatsApp Customer',
            direction: 'Outgoing',
            messageContent: messageText,
            adId: adId || lastLog?.adId || '',
            creativeName: creativeName || lastLog?.creativeName || '',
            campaign: lastLog?.campaign || '',
            product: lastLog?.product || '',
            flowName: 'Human Agent',
            nodeId: 'human_reply',
            nodeLabel: 'Human Agent Reply',
            status: 'Sent',
          },
        });
      } catch (e: any) {
        console.error('[Supabase DB Human Agent Log Error]:', e.message);
      }

      return { id: `wh-${Date.now()}`, status: 'Logged', type: 'human_outgoing' };
    }

    if (!flow) {
      // No specific ad mapping matched: check if Default Fallback Flow is enabled
      const cfg: any = await ctwaBackendService.getGOWAConfig();

      if (cfg.enableDefaultFallback) {
        // Intent / Keyword Filter Check configured from Admin Portal UI
        const rawKeywords = cfg.intentKeywords || process.env.DEFAULT_FLOW_INTENT_KEYWORDS || '';
        const keywords = String(rawKeywords).split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean);

        const cleanMsg = messageText.toLowerCase().trim();
        const isSessionActive = !!userSessionState[phoneNumber];

        // If intent keywords are specified, match incoming text or active session.
        const isIntentMatched = isSessionActive || keywords.length === 0 || keywords.some((kw: string) => cleanMsg === kw || cleanMsg.includes(kw));

        if (isIntentMatched) {
          const defaultTarget = cfg.defaultFlowId || cfg.defaultFlowName;

          if (defaultTarget) {
            flow = flows.find(
              (f: MessageFlow) =>
                f.id === defaultTarget ||
                f.flowName === defaultTarget ||
                f.id.toLowerCase() === String(defaultTarget).toLowerCase() ||
                f.flowName.toLowerCase() === String(defaultTarget).toLowerCase()
            );
          }

          if (!flow && flows.length > 0) {
            flow = flows.find((f: MessageFlow) => f.status === 'Active') || flows[0];
          }
        } else {
          console.log(`ℹ️ [CTWA Webhook] Incoming message "${messageText}" does not match configured intent keywords (${keywords.join(', ')}). Skipping auto-reply.`);
        }
      }
    }

    if (!flow) {
      console.log(`ℹ️ [CTWA Webhook] No bot flow matched for Ad ID "${adId || 'N/A'}". Logging incoming customer message to Supabase...`);
      let lastLog = await prisma.ctwaMessageLog.findFirst({
        where: { phoneNumber },
        orderBy: { createdAt: 'desc' },
      });

      try {
        await prisma.ctwaMessageLog.create({
          data: {
            timestamp: timeStr,
            phoneNumber,
            customerName: customerName !== 'WhatsApp Customer' ? customerName : lastLog?.customerName || 'WhatsApp Customer',
            direction: 'Incoming',
            messageContent: messageText,
            adId: adId || lastLog?.adId || '',
            creativeName: creativeName || lastLog?.creativeName || '',
            campaign: lastLog?.campaign || '',
            product: lastLog?.product || '',
            flowName: 'Direct Chat',
            nodeId: 'human_incoming',
            nodeLabel: 'Human Chat / No Bot',
            status: 'Received',
          },
        });
      } catch (e: any) {
        console.error('[Supabase DB Direct Chat Log Error]:', e.message);
      }

      return {
        id: `wh-${Date.now()}`,
        status: 'Logged',
        reason: 'Incoming message recorded without bot auto-reply',
      };
    }

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
        (b, idx) =>
          b.text.toLowerCase() === messageText.toLowerCase() ||
          messageText.trim() === String(idx + 1)
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

    // Natural human typing delay (default 1.5 seconds)
    const delayMs = Number(process.env.AUTO_REPLY_DELAY_MS || 1500);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

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
          customerName: payload.customerName || customerName || 'WhatsApp Customer',
          messageText,
          adId: mapping?.adId || adId || '',
          creativeName: mapping?.creativeName || creativeName || '',
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

      await prisma.ctwaMessageLog.createMany({
        data: [
          {
            timestamp: timeStr,
            phoneNumber,
            customerName: payload.customerName || customerName || 'WhatsApp Customer',
            direction: 'Incoming',
            messageContent: messageText,
            adId: mapping?.adId || adId || '',
            creativeName: mapping?.creativeName || creativeName || '',
            campaign: mapping?.campaign || '',
            product: mapping?.product || '',
            flowName: flow?.flowName || '',
            nodeId: targetNode?.id || '',
            nodeLabel: currentNodeLabel,
            status: 'Received',
          },
          {
            timestamp: timeStr,
            phoneNumber,
            customerName: payload.customerName || customerName || 'WhatsApp Customer',
            direction: 'Outgoing',
            messageContent: replyText,
            adId: mapping?.adId || adId || '',
            creativeName: mapping?.creativeName || creativeName || '',
            campaign: mapping?.campaign || '',
            product: mapping?.product || '',
            flowName: flow?.flowName || '',
            nodeId: targetNode?.id || '',
            nodeLabel: currentNodeLabel,
            status: 'Sent',
          },
        ],
      });
    } catch (e: any) {
      console.error('[Supabase DB CTWA Log Error]:', e.message);
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
        mappingsStore = dbMappings as any;
        return dbMappings as any;
      }
    } catch (e: any) {
      console.error('[Supabase DB getMappings Error]:', e.message);
    }
    return mappingsStore;
  },

  saveMapping: async (data: any) => {
    let flowId = data.flowId;
    let flowName = data.flowName;

    // Check if flow already exists
    let existingFlow = await ctwaBackendService.getFlowById(flowId);

    // Auto-generate flow payload if no flowId provided or flow doesn't exist
    if (!flowId || !existingFlow) {
      flowId = flowId || `flow-${Date.now()}`;
      flowName = flowName || `${(data.creativeName || 'AD').replace(/\s+/g, '_')}_FLOW`;

      existingFlow = {
        id: flowId,
        flowName,
        creativeId: data.creativeId || '',
        creativeName: data.creativeName || '',
        product: data.product || 'Default',
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
              messageContent: `Hello 👋\n\nThanks for reaching out!\nHow can we help you today?`,
              buttons: [
                { id: 'b1', text: 'Option 1', action: 'Go To Node', targetNodeId: '' },
                { id: 'b2', text: 'Option 2', action: 'Go To Node', targetNodeId: '' },
              ],
            },
          },
        ],
        edges: [],
      };

      await ctwaBackendService.saveFlow(existingFlow);
    }

    const updated: CreativeMapping = {
      id: data.id || `map-${Date.now()}`,
      creativeName: data.creativeName || 'Creative',
      adId: data.adId || '12001',
      creativeId: data.creativeId || 'cr-100',
      campaign: data.campaign || 'Campaign',
      adSet: data.adSet || 'Ad Set',
      product: data.product || 'Default',
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
      const dbSaved = await prisma.ctwaCreativeMapping.upsert({
        where: { id: updated.id },
        update: {
          creativeName: updated.creativeName,
          adId: updated.adId,
          creativeId: updated.creativeId,
          campaign: updated.campaign,
          adSet: updated.adSet,
          product: updated.product,
          language: updated.language,
          ctaType: updated.ctaType,
          flowId: updated.flowId,
          flowName: updated.flowName,
          status: updated.status,
        },
        create: {
          id: updated.id,
          creativeName: updated.creativeName,
          adId: updated.adId,
          creativeId: updated.creativeId,
          campaign: updated.campaign,
          adSet: updated.adSet,
          product: updated.product,
          language: updated.language,
          ctaType: updated.ctaType,
          flowId: updated.flowId,
          flowName: updated.flowName,
          status: updated.status,
        },
      });
      console.log(`[Supabase DB] Saved Creative Mapping "${dbSaved.creativeName}" ➔ "${dbSaved.flowName}" permanently`);
      return dbSaved as any;
    } catch (e: any) {
      console.error('[Supabase DB saveMapping Error]:', e.message);
    }

    return updated;
  },

  deleteMapping: async (id: string) => {
    mappingsStore = mappingsStore.filter((m) => m.id !== id);
    try {
      await prisma.ctwaCreativeMapping.delete({ where: { id } });
      console.log(`[Supabase DB] Deleted Creative Mapping ID: ${id}`);
    } catch (e: any) {
      console.error('[Supabase DB deleteMapping Error]:', e.message);
    }
    return true;
  },

  getFlows: async () => {
    try {
      const dbFlows = await prisma.ctwaMessageFlow.findMany({ orderBy: { updatedAt: 'desc' } });
      if (dbFlows && dbFlows.length > 0) {
        flowsStore = dbFlows as any;
        return dbFlows as any;
      }
    } catch (e: any) {
      console.error('[Supabase DB getFlows Error]:', e.message);
    }
    return flowsStore;
  },

  getFlowById: async (id: string) => {
    try {
      const dbFlow = await prisma.ctwaMessageFlow.findUnique({ where: { id } });
      if (dbFlow) return dbFlow as any;
    } catch (e: any) {
      console.error('[Supabase DB getFlowById Error]:', e.message);
    }

    const flows = await ctwaBackendService.getFlows();
    let flow = flows.find((f: MessageFlow) => f.id === id);

    if (!flow) {
      // Auto-generate starter flow for requested ID
      flow = {
        id,
        flowName: `FLOW_${id}`,
        creativeId: '',
        creativeName: 'Ad Creative',
        product: 'Default',
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
              messageContent: 'Hello 👋\n\nThanks for reaching out!\nHow can we help you today?',
              buttons: [
                { id: 'b1', text: 'Option 1', action: 'Go To Node', targetNodeId: '' },
              ],
            },
          },
        ],
        edges: [],
      };
      await ctwaBackendService.saveFlow(flow);
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
      product: data.product || 'Default',
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
      const dbSaved = await prisma.ctwaMessageFlow.upsert({
        where: { id: updated.id },
        update: {
          flowName: updated.flowName,
          creativeId: updated.creativeId,
          creativeName: updated.creativeName,
          product: updated.product,
          language: updated.language,
          nodes: updated.nodes as any,
          edges: updated.edges as any,
          status: updated.status,
          nodeCount: updated.nodeCount,
        },
        create: {
          id: updated.id,
          flowName: updated.flowName,
          creativeId: updated.creativeId,
          creativeName: updated.creativeName,
          product: updated.product,
          language: updated.language,
          nodes: updated.nodes as any,
          edges: updated.edges as any,
          status: updated.status,
          nodeCount: updated.nodeCount,
        },
      });
      console.log(`[Supabase DB] Saved Message Flow "${dbSaved.flowName}" (ID: ${dbSaved.id}) permanently`);
      return dbSaved as any;
    } catch (e: any) {
      console.error('[Supabase DB saveFlow Error]:', e.message);
    }

    return updated;
  },

  deleteFlow: async (id: string) => {
    flowsStore = flowsStore.filter((f) => f.id !== id);
    try {
      await prisma.ctwaMessageFlow.delete({ where: { id } });
      console.log(`[Supabase DB] Deleted Message Flow ID: ${id}`);
    } catch (e: any) {
      console.error('[Supabase DB deleteFlow Error]:', e.message);
    }
    return true;
  },

  getWebhooks: async () => {
    try {
      const dbWebhooks = await prisma.ctwaWebhookEvent.findMany({ orderBy: { createdAt: 'desc' } });
      if (dbWebhooks && dbWebhooks.length > 0) {
        return dbWebhooks as any;
      }
    } catch (e: any) {
      console.error('[Supabase DB getWebhooks Error]:', e.message);
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
    } catch (e: any) {
      console.error('[Supabase DB getMessageLogs Error]:', e.message);
    }
    return messageLogsStore;
  },

  // ─── DEDICATED URBAN SAUNA MODULE METHODS ─────────────────────────

  processUrbanWebhook: async (payload: any) => {
    const rawPayload = payload?.rawPayload || payload || {};
    const innerPayload = rawPayload?.payload || rawPayload?.data || rawPayload || {};

    const rawPhone = payload.phone || innerPayload.from || innerPayload.chat_id || rawPayload.from || rawPayload.phone || rawPayload.phoneNumber || '+971500000000';
    const phoneNumber = String(rawPhone).includes('@') ? String(rawPhone).split('@')[0] : String(rawPhone);

    let msgContent = payload.message || innerPayload.body || rawPayload.message || rawPayload.body || '';
    if (typeof msgContent === 'object' && msgContent !== null) {
      msgContent = msgContent.conversation || msgContent.text || msgContent.caption || JSON.stringify(msgContent);
    }
    const messageText = String(msgContent).trim();
    const customerName = payload.customerName || innerPayload.from_name || innerPayload.pushName || rawPayload.name || 'WhatsApp Customer';
    const isFromMe = Boolean(innerPayload.is_from_me || payload.is_from_me);
    const direction = isFromMe ? 'Outgoing' : 'Incoming';
    const mediaUrl = payload.mediaUrl || innerPayload.media_url || innerPayload.url || null;
    const mediaType = payload.mediaType || innerPayload.media_type || null;

    const timeStr = new Date().toLocaleTimeString('en-US', {
      timeZone: 'Asia/Dubai',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    const urbanDeviceId = payload.deviceId || rawPayload.deviceId || rawPayload.device_id || process.env.URBAN_SAUNA_DEVICE_ID || process.env.GOWA_URBAN_DEVICE_ID || process.env.URBAN_DEVICE_ID || 'UrbanSauna';

    try {
      const log = await prisma.urbanSaunaMessageLog.create({
        data: {
          timestamp: timeStr,
          phoneNumber,
          customerName,
          direction,
          messageContent: messageText,
          mediaUrl,
          mediaType,
          status: isFromMe ? 'Sent' : 'Received',
          deviceId: urbanDeviceId,
        },
      });
      console.log(`✅ [UrbanSauna DB Log] ${direction} message logged for ${phoneNumber}`);
      return log;
    } catch (err: any) {
      console.error('❌ [UrbanSauna DB Log Error]:', err.message);
      return { id: `urban-${Date.now()}`, phoneNumber, messageContent: messageText, direction };
    }
  },

  getUrbanMessages: async (filters?: {
    filterType?: string;
    startDate?: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    direction?: string;
    status?: string;
    phone?: string;
    search?: string;
  }) => {
    try {
      const where: any = {};

      if (filters?.phone) {
        where.phoneNumber = { contains: filters.phone };
      }

      if (filters?.direction && filters.direction !== 'All') {
        where.direction = filters.direction;
      }

      if (filters?.status && filters.status !== 'All') {
        where.status = filters.status;
      }

      if (filters?.search) {
        const query = filters.search.toLowerCase();
        where.OR = [
          { phoneNumber: { contains: query } },
          { customerName: { contains: query, mode: 'insensitive' } },
          { messageContent: { contains: query, mode: 'insensitive' } },
        ];
      }

      if (filters?.filterType === 'day') {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        where.createdAt = { gte: startOfDay };
      } else if (filters?.filterType === 'yesterday') {
        const now = new Date();
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
        where.createdAt = { gte: startOfYesterday, lte: endOfYesterday };
      } else if (filters?.filterType === 'week') {
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);
        where.createdAt = { gte: startOfWeek };
      } else if (filters?.filterType === 'month') {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        where.createdAt = { gte: startOfMonth };
      } else if (filters?.filterType === 'custom' && filters?.startDate) {
        const start = new Date(filters.startDate);
        if (filters.startTime) {
          const [h, m] = filters.startTime.split(':');
          start.setHours(parseInt(h || '0', 10), parseInt(m || '0', 10), 0, 0);
        } else {
          start.setHours(0, 0, 0, 0);
        }

        const end = filters.endDate ? new Date(filters.endDate) : new Date(start);
        if (filters.endTime) {
          const [h, m] = filters.endTime.split(':');
          end.setHours(parseInt(h || '23', 10), parseInt(m || '59', 10), 59, 999);
        } else {
          end.setHours(23, 59, 59, 999);
        }

        where.createdAt = { gte: start, lte: end };
      }

      return await prisma.urbanSaunaMessageLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });
    } catch (err: any) {
      console.error('[UrbanSauna getUrbanMessages Error]:', err.message);
      return [];
    }
  },

  getUrbanContacts: async () => {
    try {
      const allLogs = await prisma.urbanSaunaMessageLog.findMany({
        orderBy: { createdAt: 'desc' },
      });

      const contactsMap = new Map<string, {
        phoneNumber: string;
        customerName: string;
        lastMessage: string;
        lastTimestamp: string;
        lastCreatedAt: Date;
        messageCount: number;
        unreadCount: number;
      }>();

      for (const log of allLogs) {
        const phone = log.phoneNumber;
        if (!contactsMap.has(phone)) {
          contactsMap.set(phone, {
            phoneNumber: phone,
            customerName: log.customerName || 'WhatsApp Contact',
            lastMessage: log.messageContent,
            lastTimestamp: log.timestamp || new Date(log.createdAt).toLocaleTimeString(),
            lastCreatedAt: log.createdAt,
            messageCount: 1,
            unreadCount: log.direction === 'Incoming' ? 1 : 0,
          });
        } else {
          const contact = contactsMap.get(phone)!;
          contact.messageCount += 1;
        }
      }

      return Array.from(contactsMap.values());
    } catch (err: any) {
      console.error('[UrbanSauna getUrbanContacts Error]:', err.message);
      return [];
    }
  },

  sendUrbanBulkMessages: async (data: { phoneNumbers: string[]; message: string; mediaUrl?: string; mediaType?: string; delaySeconds?: number }) => {
    const { phoneNumbers, message, mediaUrl, mediaType, delaySeconds = 65 } = data;
    const results: any[] = [];
    const cfg = await ctwaBackendService.getGOWAConfig();
    const urbanDeviceId = process.env.URBAN_SAUNA_DEVICE_ID || process.env.GOWA_URBAN_DEVICE_ID || process.env.URBAN_DEVICE_ID || 'UrbanSauna';

    for (let i = 0; i < phoneNumbers.length; i++) {
      const phone = phoneNumbers[i];
      const formattedPhone = phone.replace(/[^0-9]/g, '');
      const fullJid = formattedPhone.includes('@') ? formattedPhone : `${formattedPhone}@s.whatsapp.net`;

      try {
        console.log(`[UrbanSauna Bulk Send ${i + 1}/${phoneNumbers.length}] Sending to ${formattedPhone} via X-Device-Id: ${urbanDeviceId}`);
        
        let reqBody: any = {
          phone: fullJid,
          message: message,
        };

        if (mediaUrl) {
          reqBody.url = mediaUrl;
          reqBody.media_type = mediaType || 'image';
        }

        const authUser = process.env.GOWA_BASIC_USER || process.env.GOWA_USERNAME || 'user1';
        const authPass = process.env.GOWA_BASIC_PASS || process.env.GOWA_PASSWORD || 'pass1';

        const reqConfig: any = {
          timeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            'X-Device-Id': urbanDeviceId,
          },
        };
        if (authUser && authPass) {
          reqConfig.auth = { username: authUser, password: authPass };
        }

        const resp = await axios.post(`${cfg.gowaApiUrl}/send/message`, reqBody, reqConfig);

        // Save sent message to UrbanSaunaMessageLog DB table
        const timeStr = new Date().toLocaleTimeString('en-US', {
          timeZone: 'Asia/Dubai',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
        const savedLog = await prisma.urbanSaunaMessageLog.create({
          data: {
            timestamp: timeStr,
            phoneNumber: formattedPhone,
            customerName: 'WhatsApp Customer',
            direction: 'Outgoing',
            messageContent: message,
            mediaUrl: mediaUrl || null,
            mediaType: mediaType || null,
            status: 'Sent',
            deviceId: urbanDeviceId,
          },
        });

        results.push({ phone: formattedPhone, success: true, logId: savedLog.id, response: resp.data });
      } catch (err: any) {
        console.error(`❌ [UrbanSauna Bulk Send Error for ${formattedPhone}]:`, err.message);

        // Still log attempt in DB as failed / logged
        const timeStr = new Date().toLocaleTimeString('en-US', {
          timeZone: 'Asia/Dubai',
          hour: 'numeric',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        });
        try {
          const savedLog = await prisma.urbanSaunaMessageLog.create({
            data: {
              timestamp: timeStr,
              phoneNumber: formattedPhone,
              customerName: 'WhatsApp Customer',
              direction: 'Outgoing',
              messageContent: message,
              mediaUrl: mediaUrl || null,
              mediaType: mediaType || null,
              status: 'Failed',
              deviceId: urbanDeviceId,
            },
          });
          results.push({ phone: formattedPhone, success: false, logId: savedLog.id, error: err.message });
        } catch (e: any) {
          results.push({ phone: formattedPhone, success: false, error: err.message });
        }
      }

      // Delay interval between each recipient message (e.g. 65 seconds = 1 min 5 sec)
      if (i < phoneNumbers.length - 1 && delaySeconds > 0) {
        console.log(`⏳ [UrbanSauna Bulk Send] Delaying ${delaySeconds} second(s) before sending to next recipient...`);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    return {
      total: phoneNumbers.length,
      successCount: results.filter((r) => r.success).length,
      failCount: results.filter((r) => !r.success).length,
      details: results,
    };
  },

};

