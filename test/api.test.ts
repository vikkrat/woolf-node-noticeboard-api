import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { createApp } from '../src/app.ts';
import prisma from '../prisma/client.ts';
import { config } from '../src/config.ts';

const run = randomUUID().slice(0, 8);
const username = `test_${run}`;
const password = 'Test-password-123';
const server = createApp().listen(0, '127.0.0.1');
let base: string;
let owner: any;
let other: any;
let announcementId: number;

/** Exercise the real HTTP stack and PostgreSQL; no mocked authentication or persistence. */
async function request(method: string, route: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}${route}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

before(async () => {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  // Delete only users created by this exact test run; cascades remove their fixtures.
  await prisma.user.deleteMany({ where: { username: { in: [username, `${username}_other`] } } });
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await prisma.$disconnect();
});

test('registration persists bcrypt hashes and returns correctly timed token pairs', async () => {
  const response = await request('POST', '/auth/register', { username, email: `${username}@example.com`, name: 'Test Owner', password });
  assert.equal(response.status, 201);
  owner = response.body;
  assert.equal('password' in owner.user, false);
  const saved = await prisma.user.findUniqueOrThrow({ where: { username } });
  assert.notEqual(saved.password, password);
  assert.equal(await bcrypt.compare(password, saved.password), true);
  assert.equal((await prisma.refreshToken.findUniqueOrThrow({ where: { userId: saved.id } })).token, owner.refreshToken);
  for (const [token, seconds] of [[owner.accessToken, 900], [owner.refreshToken, 604800]] as const) {
    const claims = jwt.decode(token) as jwt.JwtPayload;
    assert.equal(claims.exp! - claims.iat!, seconds);
  }
  const second = await request('POST', '/auth/register', { username: `${username}_other`, email: `${username}_other@example.com`, name: 'Other User', password });
  assert.equal(second.status, 201);
  other = second.body;
});

test('duplicate username/email yields 409; invalid registration yields 400', async () => {
  for (const values of [{ username, email: 'different@example.com' }, { username: 'different', email: `${username}@example.com` }]) {
    const response = await request('POST', '/auth/register', { ...values, name: 'Someone', password });
    assert.equal(response.status, 409);
    assert.equal(response.body.error, 'Username or email already taken');
  }
  for (const values of [{ username: 'ab' }, { email: 'invalid' }, { name: 'A' }, { password: 'short' }, { password: '😀'.repeat(30) }]) {
    assert.equal((await request('POST', '/auth/register', { username: 'valid_name', email: 'valid@example.com', name: 'Valid Name', password, ...values })).status, 400);
  }
});

test('login hides credential details and invalidates the earlier refresh token', async () => {
  const missing = await request('POST', '/auth/login', { username: `missing_${run}`, password });
  const incorrect = await request('POST', '/auth/login', { username, password: 'incorrect' });
  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
  assert.deepEqual(missing.body, { error: 'Invalid credentials' });
  assert.deepEqual(missing.body, incorrect.body);
  const previous = owner.refreshToken;
  const response = await request('POST', '/auth/login', { username, password });
  assert.equal(response.status, 200);
  owner = response.body;
  assert.notEqual(previous, owner.refreshToken);
  assert.equal((await request('POST', '/auth/refresh', { refreshToken: previous })).status, 401);
});

test('refresh rotates once; concurrent requests produce exactly one successful rotation', async () => {
  const previous = owner.refreshToken;
  const results = await Promise.all([request('POST', '/auth/refresh', { refreshToken: previous }), request('POST', '/auth/refresh', { refreshToken: previous })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
  owner = { ...owner, ...results.find(result => result.status === 200)!.body };
  assert.notEqual(owner.refreshToken, previous);
  assert.equal((await request('POST', '/auth/refresh', { refreshToken: previous })).status, 401);
  assert.equal((await request('POST', '/auth/refresh', { refreshToken: owner.accessToken })).status, 401);
});

test('protected profile rejects missing, malformed, expired and refresh tokens', async () => {
  const expired = jwt.sign({ sub: owner.user.id, type: 'access' }, config.jwtSecret, { algorithm: 'HS256', issuer: 'noticeboard-api', audience: 'noticeboard-client', expiresIn: -1 });
  for (const token of [undefined, 'invalid', expired, owner.refreshToken]) {
    assert.equal((await request('GET', '/auth/me', undefined, token)).status, 401);
  }
  const profile = await request('GET', '/auth/me', undefined, owner.accessToken);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.username, username);
  assert.equal(typeof profile.body.createdAt, 'string');
  assert.equal('password' in profile.body, false);
});

test('announcement creation validates fields and derives author from access token', async () => {
  const body = { title: `Notebook ${run}`, description: 'A well maintained notebook for sale.', price: 300, category: 'sale' };
  assert.equal((await request('POST', '/announcements', body)).status, 401);
  for (const change of [{ userId: other.user.id }, { title: 'tiny' }, { description: 'short' }, { price: 0 }, { price: '100' }, { category: 'invalid' }]) {
    assert.equal((await request('POST', '/announcements', { ...body, ...change }, owner.accessToken)).status, 400);
  }
  const response = await request('POST', '/announcements', body, owner.accessToken);
  assert.equal(response.status, 201);
  announcementId = response.body.id;
  assert.equal(response.body.user.id, owner.user.id);
  assert.equal('password' in response.body.user, false);
  const fetched = await request('GET', `/announcements/${announcementId}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual(fetched.body, response.body);
});

test('public search is case-insensitive with stable sort and ten records per page', async () => {
  const anchor = Date.now() - 100000;
  await prisma.announcement.createMany({ data: Array.from({ length: 12 }, (_, index) => ({ title: `Search-${run} Item ${index}`, description: 'Pagination test fixture', price: index + 1, category: 'other', userId: owner.user.id, createdAt: new Date(anchor + index * 1000) })) });
  const first = await request('GET', `/announcements?search=SEARCH-${run}&sort=oldest`);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.pagination, { total: 12, page: 1, totalPages: 2, perPage: 10 });
  assert.equal(first.body.data.length, 10);
  assert.equal(first.body.data[0].title, `Search-${run} Item 0`);
  const second = await request('GET', `/announcements?search=search-${run}&page=2&sort=oldest`);
  assert.equal(second.body.data.length, 2);
  const newest = await request('GET', `/announcements?search=search-${run}`);
  assert.equal(newest.body.data[0].title, `Search-${run} Item 11`);
  assert.equal((await request('GET', `/announcements?search=search-${run}&page=999`)).body.data.length, 0);
  const all = await request('GET', '/announcements?search=');
  assert.equal(all.status, 200);
  for (const query of ['page=0', 'page=1.5', 'page=abc', 'sort=wrong', 'page=1&page=2']) assert.equal((await request('GET', `/announcements?${query}`)).status, 400);
  await prisma.announcement.create({ data: { title: `100%_${run}`, description: 'Literal wildcard fixture', price: 1, category: 'other', userId: owner.user.id } });
  assert.equal((await request('GET', `/announcements?search=${encodeURIComponent(`%_${run}`)}`)).body.pagination.total, 1);
});

test('only owners can patch/delete; empty patch fails and updatedAt changes', async () => {
  for (const method of ['PATCH', 'DELETE']) {
    const response = await request(method, `/announcements/${announcementId}`, method === 'PATCH' ? { price: 200 } : undefined, other.accessToken);
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'Access denied');
  }
  assert.equal((await request('PATCH', `/announcements/${announcementId}`, {}, owner.accessToken)).status, 400);
  const before = (await request('GET', `/announcements/${announcementId}`)).body;
  const updated = await request('PATCH', `/announcements/${announcementId}`, { price: 250 }, owner.accessToken);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.title, before.title);
  assert.equal(updated.body.price, 250);
  assert.ok(new Date(updated.body.updatedAt) > new Date(before.updatedAt));
  const deleted = await request('DELETE', `/announcements/${announcementId}`, undefined, owner.accessToken);
  assert.equal(deleted.status, 204);
  assert.equal(deleted.text, '');
  assert.equal((await request('GET', `/announcements/${announcementId}`)).status, 404);
  assert.equal((await request('PATCH', `/announcements/${announcementId}`, { price: 1 }, owner.accessToken)).status, 404);
  assert.equal((await request('DELETE', `/announcements/${announcementId}`, undefined, owner.accessToken)).status, 404);
});

test('logout is idempotent and revokes refresh without pretending to revoke access tokens', async () => {
  assert.equal((await request('POST', '/auth/logout')).status, 401);
  for (let i = 0; i < 2; i++) {
    const response = await request('POST', '/auth/logout', undefined, owner.accessToken);
    assert.equal(response.status, 204);
    assert.equal(response.text, '');
  }
  assert.equal((await request('POST', '/auth/refresh', { refreshToken: owner.refreshToken })).status, 401);
  assert.equal((await request('GET', '/auth/me', undefined, owner.accessToken)).status, 200);
});

test('JSON errors, ID validation and OpenAPI document match the API contract', async () => {
  assert.equal((await request('GET', '/announcements/not-a-number')).status, 400);
  assert.equal((await request('GET', '/missing')).status, 404);
  const malformed = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
  assert.equal(malformed.status, 400);
  const document = (await request('GET', '/openapi.json')).body;
  assert.equal(Object.values(document.paths).reduce((sum: number, route: any) => sum + Object.keys(route).length, 0), 10);
  assert.equal(document.components.securitySchemes.bearerAuth.scheme, 'bearer');
  assert.deepEqual(document.paths['/auth/logout'].post.security, [{ bearerAuth: [] }]);
  const docs = await fetch(`${base}/api-docs/`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui/);
});
