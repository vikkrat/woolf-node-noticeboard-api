import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { HttpError } from '../errors.ts';

const issuer = 'noticeboard-api';
const audience = 'noticeboard-client';

/** Unique token IDs prevent identical tokens when login/rotation occurs in the same second. */
export function issueTokens(userId: number) {
  const sign = (type: 'access' | 'refresh', expiresIn: '15m' | '7d') => jwt.sign(
    { sub: userId, type }, config.jwtSecret,
    { algorithm: 'HS256', expiresIn, issuer, audience, jwtid: randomUUID() },
  );
  return { accessToken: sign('access', '15m'), refreshToken: sign('refresh', '7d') };
}

/** Verify signature, expiration and token purpose before trusting the numeric subject. */
export function verifyToken(token: string, type: 'access' | 'refresh'): number {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer, audience });
    if (typeof payload === 'string' || payload.type !== type || !Number.isSafeInteger(payload.sub) || Number(payload.sub) <= 0) {
      throw new Error('Invalid token claims');
    }
    return Number(payload.sub);
  } catch { throw new HttpError(401, 'Invalid or expired token'); }
}
