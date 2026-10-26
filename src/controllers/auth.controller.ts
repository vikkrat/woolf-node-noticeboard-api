import type { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../../prisma/client.ts';
import { HttpError } from '../errors.ts';
import { issueTokens, verifyToken } from '../services/tokens.ts';

export const publicUser = { id: true, username: true, email: true, name: true } as const;
// Compare against a valid dummy hash when the user is missing to reduce timing differences.
const dummyHash = await bcrypt.hash('dummy-password-not-used-for-login', 12);

/** Create user and session atomically; unique indexes also protect against registration races. */
export const register: RequestHandler = async (_req, res) => {
  const { username, email, name, password } = res.locals.body;
  if (await prisma.user.findFirst({ where: { OR: [{ username }, { email }] }, select: { id: true } })) {
    throw new HttpError(409, 'Username or email already taken');
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await prisma.$transaction(async tx => {
    const user = await tx.user.create({ data: { username, email, name, password: hash }, select: publicUser });
    const tokens = issueTokens(user.id);
    await tx.refreshToken.create({ data: { userId: user.id, token: tokens.refreshToken } });
    return { user, ...tokens };
  });
  res.status(201).json(result);
};

/** Use one error for unknown usernames and incorrect passwords; replace the previous session. */
export const login: RequestHandler = async (_req, res) => {
  const { username, password } = res.locals.body;
  const user = await prisma.user.findUnique({ where: { username } });
  const valid = await bcrypt.compare(password, user?.password ?? dummyHash);
  if (!user || !valid) throw new HttpError(401, 'Invalid credentials');
  const tokens = issueTokens(user.id);
  await prisma.refreshToken.upsert({ where: { userId: user.id }, create: { userId: user.id, token: tokens.refreshToken }, update: { token: tokens.refreshToken } });
  res.json({ user: { id: user.id, username: user.username, email: user.email, name: user.name }, ...tokens });
};

/** Atomically consume the previous token; concurrent refresh attempts cannot both succeed. */
export const refresh: RequestHandler = async (_req, res) => {
  const { refreshToken } = res.locals.body;
  const userId = verifyToken(refreshToken, 'refresh');
  const tokens = issueTokens(userId);
  const changed = await prisma.refreshToken.updateMany({ where: { token: refreshToken, userId }, data: { token: tokens.refreshToken } });
  if (changed.count !== 1) throw new HttpError(401, 'Invalid or expired token');
  res.json(tokens);
};

/** Idempotently revoke refresh sessions; existing access tokens expire after 15 minutes. */
export const logout: RequestHandler = async (req, res) => {
  await prisma.refreshToken.deleteMany({ where: { userId: req.user!.sub } });
  res.status(204).end();
};

/** Select public fields explicitly so password hashes can never enter profile responses. */
export const me: RequestHandler = async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { ...publicUser, createdAt: true } });
  if (!user) throw new HttpError(401, 'Invalid or expired token');
  res.json(user);
};
