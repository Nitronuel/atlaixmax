import { createServer } from 'node:http';
import { loadEnvFile, readEnv } from './env';
import { setBaseHeaders, sendJson, sendNotFound } from './http/response';
import { InsightXRoutes } from './insightx/routes';

loadEnvFile('.env');
loadEnvFile('.env.local', true);

const port = Number(readEnv('API_PORT', 'PORT') || 3101);
const host = readEnv('API_HOST', 'HOST') || '0.0.0.0';
const insightXRoutes = new InsightXRoutes();

const server = createServer(async (request, response) => {
  setBaseHeaders(response);
  if ((request.method || 'GET').toUpperCase() === 'OPTIONS') {
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

    if (requestUrl.pathname.startsWith('/api/insightx')) {
      await insightXRoutes.handle(request, response, requestUrl);
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
  console.log(`Atlaix API listening on http://${host}:${port}`);
});
