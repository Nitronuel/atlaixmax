import type { IncomingMessage, ServerResponse } from 'node:http';
import { normalizeBubblemapsChain } from '../../src/shared/bubblemaps';
import { sendJson } from '../http/response';
import { GoPlusSecurityService } from './goplus-service';

export class SecurityScannerRoutes {
  private readonly service = new GoPlusSecurityService();

  async handle(_request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    if (requestUrl.pathname !== '/api/security-scanner/token') {
      sendJson(response, 404, { error: 'Security scanner endpoint not found.' });
      return;
    }

    const chain = normalizeBubblemapsChain(requestUrl.searchParams.get('chain'));
    const address = requestUrl.searchParams.get('address')?.trim() || '';
    if (!chain || !address) {
      sendJson(response, 400, { error: 'Choose a supported chain and token address.' });
      return;
    }

    sendJson(response, 200, await this.service.getTokenSecurity(chain, address));
  }
}
