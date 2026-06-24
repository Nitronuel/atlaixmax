import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser } from '../auth';
import { readEnv } from '../env';
import { sendJson, sendNotFound } from '../http/response';
import {
  completeTelegramLink,
  createTelegramLink,
  disconnectTelegramConnection,
  getTelegramConnectionStatus,
  parseTelegramStartToken,
  sendTelegramText
} from '../smart-alerts/telegram';

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class TelegramRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/telegram/status') {
      const user = await requireAuthenticatedUser(request);
      sendJson(response, 200, await getTelegramConnectionStatus(user.id));
      return;
    }

    if (method === 'POST' && pathname === '/api/telegram/link-token') {
      const user = await requireAuthenticatedUser(request);
      sendJson(response, 200, await createTelegramLink(user.id));
      return;
    }

    if (method === 'POST' && pathname === '/api/telegram/disconnect') {
      const user = await requireAuthenticatedUser(request);
      await disconnectTelegramConnection(user.id);
      sendJson(response, 200, { disconnected: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/telegram/webhook') {
      const expectedSecret = readEnv('TELEGRAM_WEBHOOK_SECRET');
      const receivedSecret = request.headers['x-telegram-bot-api-secret-token'];
      const normalizedSecret = Array.isArray(receivedSecret) ? receivedSecret[0] : receivedSecret;
      if (expectedSecret && normalizedSecret !== expectedSecret) {
        sendJson(response, 401, { error: 'Invalid Telegram webhook secret.' });
        return;
      }

      const body = await readJsonBody(request);
      const message = body?.message || body?.edited_message || {};
      const text = typeof message?.text === 'string' ? message.text : '';
      const token = parseTelegramStartToken(text);
      if (!token) {
        sendJson(response, 200, { ok: true, ignored: true });
        return;
      }

      const result = await completeTelegramLink(token, message.chat || {}, message.from || {});
      const chatId = message?.chat?.id === undefined || message?.chat?.id === null ? '' : String(message.chat.id);
      if (chatId && result.linked) {
        await sendTelegramText(chatId, 'Telegram alerts are connected to your Atlaix account.');
      } else if (chatId && result.reason === 'expired') {
        await sendTelegramText(chatId, 'That Atlaix link expired. Create a fresh Telegram link in Atlaix settings.');
      } else if (chatId) {
        await sendTelegramText(chatId, 'That Atlaix link could not be used. Create a fresh Telegram link in Atlaix settings.');
      }

      sendJson(response, 200, { ok: true, linked: result.linked, reason: result.reason });
      return;
    }

    sendNotFound(response);
  }
}
