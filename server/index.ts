import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { loadEnvFile, readEnv } from './env';
import { AiAssistantRoutes } from './ai-assistant/routes';
import { BubblemapsRoutes } from './bubblemaps/routes';
import { CoinGeckoRoutes } from './coingecko/routes';
import { startCoinGeckoIngestionScheduler } from './coingecko/database';
import { DetectionRoutes } from './detection/routes';
import { setBaseHeaders, sendJson, sendNotFound } from './http/response';
import { startOverviewIngestionScheduler } from './overview/database';
import { OverviewRoutes } from './overview/routes';
import { SecurityScannerRoutes } from './security-scanner/routes';
import { SmartAlertRoutes } from './smart-alerts/routes';
import { SmartMoneyRoutes } from './smart-money/routes';
import { WalletRoutes } from './wallet/routes';

loadEnvFile('.env');
loadEnvFile('.env.local', true);

const port = Number(readEnv('API_PORT', 'PORT') || 3101);
const host = readEnv('API_HOST', 'HOST') || '0.0.0.0';
const bubblemapsRoutes = new BubblemapsRoutes();
const overviewRoutes = new OverviewRoutes();
const coinGeckoRoutes = new CoinGeckoRoutes();
const smartAlertRoutes = new SmartAlertRoutes();
const aiAssistantRoutes = new AiAssistantRoutes(smartAlertRoutes);
const smartMoneyRoutes = new SmartMoneyRoutes();
const walletRoutes = new WalletRoutes();
const detectionRoutes = new DetectionRoutes();
const securityScannerRoutes = new SecurityScannerRoutes();
const clientRoot = resolve(process.cwd(), 'dist');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

function isInsideClientRoot(filepath: string) {
  return filepath === clientRoot || filepath.startsWith(`${clientRoot}${sep}`);
}

async function sendFile(response: ServerResponse, filepath: string, method: string) {
  const fileStat = await stat(filepath);
  if (!fileStat.isFile()) {
    sendNotFound(response);
    return;
  }

  response.writeHead(200, {
    'Content-Length': fileStat.size,
    'Content-Type': contentTypes[extname(filepath)] || 'application/octet-stream'
  });
  if (method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filepath).pipe(response);
}

async function serveClient(requestPath: string, response: ServerResponse, method: string) {
  if (!existsSync(clientRoot)) {
    sendNotFound(response);
    return;
  }

  const pathname = decodeURIComponent(requestPath);
  const requestedPath = resolve(clientRoot, pathname.replace(/^\/+/, ''));
  if (!isInsideClientRoot(requestedPath)) {
    sendNotFound(response);
    return;
  }

  if (existsSync(requestedPath)) {
    await sendFile(response, requestedPath, method);
    return;
  }

  await sendFile(response, join(clientRoot, 'index.html'), method);
}

const server = createServer(async (request, response) => {
  setBaseHeaders(response);
  const method = (request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  try {
    if (requestUrl.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (requestUrl.pathname.startsWith('/api/bubblemaps')) {
      await bubblemapsRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/overview')) {
      await overviewRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/coingecko')) {
      await coinGeckoRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/detection')) {
      await detectionRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/security-scanner')) {
      await securityScannerRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/smart-money')) {
      await smartMoneyRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/smart-alerts')) {
      await smartAlertRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/ai-assistant')) {
      await aiAssistantRoutes.handle(request, response, requestUrl);
      return;
    }

    if (requestUrl.pathname.startsWith('/api/wallet')) {
      await walletRoutes.handle(request, response, requestUrl);
      return;
    }

    if (method === 'GET' || method === 'HEAD') {
      await serveClient(requestUrl.pathname, response, method);
      return;
    }

    sendNotFound(response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Internal server error.'
    });
  }
});

server.listen(port, host, () => {
  startOverviewIngestionScheduler();
  startCoinGeckoIngestionScheduler();
  smartAlertRoutes.start();
  detectionRoutes.start();
  console.log(`Atlaix API listening on http://${host}:${port}`);
});
