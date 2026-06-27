import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser } from '../auth';
import { sendJson, sendNotFound } from '../http/response';
import { lookupSmartAlertToken, SmartAlertRunner } from './runner';
import { SmartAlertStore, type SmartAlertRow, type SmartAlertTriggerRow } from './store';
import { createWalletActivityAlert, processWalletWebhook } from './wallet-alerts';

async function readRawJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return { raw, body: raw ? JSON.parse(raw) : {} };
}

async function readJsonBody(request: IncomingMessage) {
  return (await readRawJsonBody(request)).body;
}

function isVisibleAlertTrigger(trigger: SmartAlertTriggerRow) {
  return trigger.alert_type !== 'Detection' || trigger.source !== 'detection-engine' || trigger.metadata?.alertSource === 'smart_alerts_page';
}

function isVisibleAlertRule(rule: SmartAlertRow) {
  return rule.alert_type !== 'Detection' || rule.metadata?.alertMode !== 'detection_event' || rule.metadata?.createdFrom === 'smart_alerts_page';
}

export class SmartAlertRoutes {
  readonly store = new SmartAlertStore();
  readonly runner = new SmartAlertRunner(this.store);

  start() {
    this.runner.start();
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/smart-alerts/status') {
      sendJson(response, 200, this.runner.getStatus());
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/run') {
      sendJson(response, 200, await this.runner.runNow());
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/wallet-webhook') {
      const { raw } = await readRawJsonBody(request);
      sendJson(response, 200, await processWalletWebhook(this.store, raw, request.headers));
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/token-lookup') {
      const address = requestUrl.searchParams.get('address') || '';
      const chain = requestUrl.searchParams.get('chain') || '';
      if (!address.trim()) {
        sendJson(response, 400, { error: 'Token address is required.' });
        return;
      }

      const token = await lookupSmartAlertToken(address, chain);
      if (!token) {
        sendJson(response, 404, { error: 'Token was not found.' });
        return;
      }

      sendJson(response, 200, { token });
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/rules') {
      const user = await requireAuthenticatedUser(request);
      const rules = await this.store.listRules(user.id);
      sendJson(response, 200, { rules: rules.filter(isVisibleAlertRule) });
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/rules') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const rule = await this.store.createRule(body, user.id);
      sendJson(response, 200, { rule });
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/wallet-activity-rules') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const result = await createWalletActivityAlert(this.store, {
        address: body.address,
        chain: body.chain,
        label: body.label,
        eventTypes: Array.isArray(body.eventTypes) ? body.eventTypes : undefined,
        notificationChannels: Array.isArray(body.notificationChannels) ? body.notificationChannels : undefined,
        ignoreSpam: body.ignoreSpam !== false,
        cooldownMinutes: Number.isFinite(Number(body.cooldownMinutes)) ? Number(body.cooldownMinutes) : undefined
      }, user.id);
      sendJson(response, 200, result);
      return;
    }

    const ruleMatch = pathname.match(/^\/api\/smart-alerts\/rules\/([^/]+)$/);
    if (ruleMatch && method === 'PATCH') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const patch: Partial<SmartAlertRow> = {};
      if ('enabled' in body) patch.enabled = Boolean(body.enabled);
      if ('metadata' in body) patch.metadata = body.metadata;
      if (Array.isArray(body.notificationChannels)) patch.notification_channels = body.notificationChannels;
      const rule = await this.store.updateRule(decodeURIComponent(ruleMatch[1]), patch, user.id);
      sendJson(response, 200, { rule });
      return;
    }

    if (ruleMatch && method === 'DELETE') {
      const user = await requireAuthenticatedUser(request);
      await this.store.deleteRule(decodeURIComponent(ruleMatch[1]), user.id);
      sendJson(response, 200, { deleted: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/triggers') {
      const user = await requireAuthenticatedUser(request);
      const limit = Number(requestUrl.searchParams.get('limit') || 50);
      const triggers = await this.store.listTriggers(Number.isFinite(limit) ? limit : 50, user.id);
      sendJson(response, 200, { triggers: triggers.filter(isVisibleAlertTrigger) });
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/detection-subscription') {
      const user = await requireAuthenticatedUser(request);
      const chain = requestUrl.searchParams.get('chain') || '';
      const address = requestUrl.searchParams.get('address') || '';
      if (!chain.trim() || !address.trim()) {
        sendJson(response, 400, { error: 'Token chain and address are required.' });
        return;
      }
      const subscription = await this.store.getDetectionSubscription(user.id, chain, address);
      sendJson(response, 200, { subscription });
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/detection-subscriptions') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const subscription = await this.store.createDetectionSubscription({
        userId: user.id,
        scope: body.scope === 'all' ? 'all' : 'token',
        chainId: body.chainId,
        tokenAddress: body.tokenAddress,
        tokenName: body.tokenName,
        tokenSymbol: body.tokenSymbol,
        condition: body.condition,
        thresholdKind: body.thresholdKind,
        threshold: body.threshold,
        notificationChannels: Array.isArray(body.notificationChannels) ? body.notificationChannels : undefined,
        source: body.source
      });
      sendJson(response, 200, { subscription });
      return;
    }

    sendNotFound(response);
  }
}
