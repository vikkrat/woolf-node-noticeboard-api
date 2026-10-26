import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.ts';
import prisma from '../prisma/client.ts';

const run = randomUUID().slice(0, 8);
const usernames = [`demo_${run}`, `guest_${run}`];
const server = createApp().listen(0, '127.0.0.1');
const evidence: Record<string, unknown[]> = { '02-authentication': [], '03-announcements': [], '04-ownership': [], '05-token-lifecycle': [] };
let base: string;

/** Remove bearer credentials from saved evidence while preserving actual response structure. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, ['accessToken', 'refreshToken', 'password'].includes(key) ? '[redacted]' : redact(entry)]));
  return value;
}

/** Record real HTTP status codes and JSON responses; never print or save live tokens. */
async function request(group: string, method: string, route: string, expected: number, body?: unknown, token?: string) {
  const response = await fetch(`${base}${route}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  evidence[group].push({ request: `${method} ${route}`, status: response.status, response: redact(payload) });
  if (response.status !== expected) throw new Error(`${method} ${route}: expected ${expected}, received ${response.status}`);
  console.log(`${response.status} ${method} ${route}`);
  return payload;
}

/** Demonstrate complete flows with temporary users and delete only this run's records. */
async function demo() {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  base = `http://127.0.0.1:${address.port}`;
  try {
    const owner = await request('02-authentication', 'POST', '/auth/register', 201, { username: usernames[0], email: `${usernames[0]}@example.com`, name: 'Demo Publisher', password: 'Demo-password-123' });
    await request('02-authentication', 'GET', '/auth/me', 200, undefined, owner.accessToken);
    await request('02-authentication', 'GET', '/auth/me', 401);
    const guest = await request('04-ownership', 'POST', '/auth/register', 201, { username: usernames[1], email: `${usernames[1]}@example.com`, name: 'Demo Visitor', password: 'Demo-password-123' });
    const item = await request('03-announcements', 'POST', '/announcements', 201, { title: 'City bicycle for sale', description: 'Well maintained bicycle with lights and a basket.', price: 180, category: 'sale' }, owner.accessToken);
    await request('03-announcements', 'GET', '/announcements?search=BICYCLE&sort=newest&page=1', 200);
    await request('04-ownership', 'PATCH', `/announcements/${item.id}`, 403, { price: 100 }, guest.accessToken);
    await request('04-ownership', 'DELETE', `/announcements/${item.id}`, 403, undefined, guest.accessToken);
    await request('04-ownership', 'PATCH', `/announcements/${item.id}`, 200, { price: 160 }, owner.accessToken);
    const rotated = await request('05-token-lifecycle', 'POST', '/auth/refresh', 200, { refreshToken: owner.refreshToken });
    await request('05-token-lifecycle', 'POST', '/auth/refresh', 401, { refreshToken: owner.refreshToken });
    await request('05-token-lifecycle', 'POST', '/auth/logout', 204, undefined, rotated.accessToken);
    await request('05-token-lifecycle', 'POST', '/auth/refresh', 401, { refreshToken: rotated.refreshToken });
    await mkdir('screenshots', { recursive: true });
    for (const [name, records] of Object.entries(evidence)) await writeFile(`screenshots/${name}.json`, `${JSON.stringify(records, null, 2)}\n`);
    console.log('Saved real HTTP evidence; credentials redacted.');
  } finally {
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}

demo().catch(error => { console.error(error); process.exitCode = 1; });
