import type { ServerResponse } from 'node:http';

export function setBaseHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  setBaseHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function sendNotFound(response: ServerResponse) {
  sendJson(response, 404, { error: 'Route not found.' });
}
