import { Router, Request, Response } from 'express';
import { ctwaBackendService } from '../services/ctwaService.js';

const router = Router();

/**
 * @route   POST /api/ctwa/webhook
 * @desc    Incoming WhatsApp CTWA Webhook Endpoint called by GOWA EC2 instance
 * @access  Public / Server-to-Server
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    console.log('📥 [CTWA Webhook Received from GOWA EC2]:', JSON.stringify(req.body, null, 2));

    const body = req.body || {};
    const innerPayload = body.payload || body.data || body;
    const referral = innerPayload.referral || body.referral || {};

    const rawPhone = innerPayload.from || innerPayload.chat_id || body.phone || body.from || body.phoneNumber;
    const message = innerPayload.body || body.message || body.messageText || body.body;
    const customerName = innerPayload.from_name || innerPayload.pushName || body.customerName || body.name;
    const adId = referral.source_id || referral.ref || body.adId || body.ad_id;
    const creativeName = referral.ad_title || body.creativeName || body.creative_name;

    const result = await ctwaBackendService.processIncomingWebhook({
      phone: rawPhone,
      message,
      adId,
      creativeName,
      customerName,
      referral,
      rawPayload: body,
    });

    return res.status(200).json({
      success: true,
      message: 'CTWA Webhook processed successfully via GOWA',
      eventId: result.id,
      data: result,
    });
  } catch (error: any) {
    console.error('❌ [CTWA Webhook Error]:', error);
    return res.status(500).json({
      success: false,
      error: 'Webhook processing error',
      details: error.message,
    });
  }
});

/**
 * @route   GET /api/ctwa/webhook
 * @desc    GOWA / Meta Webhook Verification Endpoint
 */
router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === (process.env.CTWA_VERIFY_TOKEN || 'wellnesslab_ctwa_token')) {
      console.log('✅ CTWA Webhook Verified Successfully');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }

  return res.json({
    status: 'CTWA Webhook Endpoint Active',
    webhookUrl: `${req.protocol}://${req.get('host')}/api/ctwa/webhook`,
  });
});

/**
 * @route   GET /api/ctwa/gowa-config
 * @desc    Get GOWA EC2 Server & Webhook Configuration
 */
router.get('/gowa-config', async (req: Request, res: Response) => {
  const cfg = await ctwaBackendService.getGOWAConfig();
  return res.json({ success: true, data: cfg });
});

/**
 * @route   PUT /api/ctwa/gowa-config
 * @desc    Update GOWA EC2 Server IP & Webhook URL Settings
 */
router.put('/gowa-config', async (req: Request, res: Response) => {
  const updated = await ctwaBackendService.updateGOWAConfig(req.body);
  return res.json({ success: true, data: updated });
});

/**
 * @route   GET /api/ctwa/dashboard
 * @desc    Get CTWA Module Overview Statistics
 */
router.get('/dashboard', async (req: Request, res: Response) => {
  const stats = await ctwaBackendService.getDashboardStats();
  return res.json({ success: true, data: stats });
});

/**
 * @route   GET /api/ctwa/ads
 * @desc    Get all Meta Ad Creatives
 */
router.get('/ads', async (req: Request, res: Response) => {
  const list = await ctwaBackendService.getCreatives();
  return res.json({ success: true, data: list });
});

/**
 * @route   POST /api/ctwa/fetch-meta
 * @desc    Fetch live Meta Ad Creatives directly from Meta Graph API
 */
router.post('/fetch-meta', async (req: Request, res: Response) => {
  const { adAccountId, accessToken } = req.body || {};
  const result = await ctwaBackendService.fetchFromMetaGraphApi(adAccountId, accessToken);
  return res.json(result);
});

/**
 * @route   POST /api/ctwa/ads
 * @desc    Create manual Meta Ad Creative mapping
 */
router.post('/ads', async (req: Request, res: Response) => {
  const creative = req.body;
  const created = await ctwaBackendService.addCreative(creative);
  return res.status(201).json({ success: true, data: created });
});

/**
 * @route   GET /api/ctwa/mappings
 * @desc    Get all Creative Mappings
 */
router.get('/mappings', async (req: Request, res: Response) => {
  const list = await ctwaBackendService.getMappings();
  return res.json({ success: true, data: list });
});

/**
 * @route   POST /api/ctwa/mappings
 * @desc    Save/Create Creative Mapping
 */
router.post('/mappings', async (req: Request, res: Response) => {
  const mapping = req.body;
  const saved = await ctwaBackendService.saveMapping(mapping);
  return res.json({ success: true, data: saved });
});

/**
 * @route   DELETE /api/ctwa/mappings/:id
 * @desc    Delete Creative Mapping
 */
router.delete('/mappings/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  await ctwaBackendService.deleteMapping(id);
  return res.json({ success: true, message: 'Mapping deleted successfully' });
});

/**
 * @route   GET /api/ctwa/flows
 * @desc    Get all Message Flows
 */
router.get('/flows', async (req: Request, res: Response) => {
  const flows = await ctwaBackendService.getFlows();
  return res.json({ success: true, data: flows });
});

/**
 * @route   GET /api/ctwa/flows/:id
 * @desc    Get single Message Flow by ID
 */
router.get('/flows/:id', async (req: Request, res: Response) => {
  const flow = await ctwaBackendService.getFlowById(req.params.id);
  if (!flow) {
    return res.status(404).json({ success: false, error: 'Flow not found' });
  }
  return res.json({ success: true, data: flow });
});

/**
 * @route   POST /api/ctwa/flows
 * @desc    Save/Create Message Flow
 */
router.post('/flows', async (req: Request, res: Response) => {
  const flow = req.body;
  const saved = await ctwaBackendService.saveFlow(flow);
  return res.json({ success: true, data: saved });
});

/**
 * @route   DELETE /api/ctwa/flows/:id
 * @desc    Delete Message Flow
 */
router.delete('/flows/:id', async (req: Request, res: Response) => {
  await ctwaBackendService.deleteFlow(req.params.id);
  return res.json({ success: true, message: 'Flow deleted successfully' });
});

/**
 * @route   GET /api/ctwa/webhooks
 * @desc    Get all Webhook Event Logs
 */
router.get('/webhooks', async (req: Request, res: Response) => {
  const webhooks = await ctwaBackendService.getWebhooks();
  return res.json({ success: true, data: webhooks });
});

/**
 * @route   GET /api/ctwa/webhooks/:id
 * @desc    Get Webhook Event Details & Timeline
 */
router.get('/webhooks/:id', async (req: Request, res: Response) => {
  const event = await ctwaBackendService.getWebhookById(req.params.id);
  if (!event) {
    return res.status(404).json({ success: false, error: 'Webhook event not found' });
  }
  return res.json({ success: true, data: event });
});

/**
 * @route   GET /api/ctwa/messages
 * @desc    Get all incoming & outgoing CTWA message logs
 */
router.get('/messages', async (req: Request, res: Response) => {
  const logs = await ctwaBackendService.getMessageLogs();
  return res.json({ success: true, data: logs });
});

/**
 * @route   POST /api/ctwa/simulate-webhook
 * @desc    Simulate incoming Webhook trigger
 */
router.post('/simulate-webhook', async (req: Request, res: Response) => {
  const result = await ctwaBackendService.processIncomingWebhook(req.body);
  return res.json({ success: true, data: result });
});

export default router;
