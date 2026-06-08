import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendNotFound } from '../http/response';
import { SmartMoneyDatabase } from './database';

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class SmartMoneyRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();

    if (method === 'GET' && requestUrl.pathname === '/api/smart-money/wallets') {
      const wallets = await SmartMoneyDatabase.listWallets();
      sendJson(response, 200, {
        wallets,
        generatedAt: new Date().toISOString(),
        source: 'database'
      });
      return;
    }

    if (method === 'POST' && requestUrl.pathname === '/api/smart-money/wallets') {
      const body = await readJsonBody(request);
      const wallet = await SmartMoneyDatabase.promoteWallet(body.wallet);
      sendJson(response, 200, {
        wallet,
        promoted: true,
        generatedAt: new Date().toISOString()
      });
      return;
    }

    sendNotFound(response);
  }
}
