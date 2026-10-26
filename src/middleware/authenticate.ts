import type { RequestHandler } from 'express';
import prisma from '../../prisma/client.ts';
import { verifyToken } from '../services/tokens.ts';
import { HttpError } from '../errors.ts';

declare global {
  namespace Express {
    interface Request { user?: { sub: number } }
  }
}

/** Authenticate access tokens only; refresh tokens never authorize resource operations. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '');
  if (!match) throw new HttpError(401, 'Authentication required');
  const sub = verifyToken(match[1], 'access');
  if (!await prisma.user.findUnique({ where: { id: sub }, select: { id: true } })) {
    throw new HttpError(401, 'Invalid or expired token');
  }
  req.user = { sub };
  next();
};
