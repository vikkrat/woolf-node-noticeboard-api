import { z } from 'zod';

// bcrypt uses at most 72 input bytes; reject longer passwords instead of silently truncating.
const password = z.string().min(6).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const registerSchema = z.object({
  username: z.string().trim().min(3).max(30),
  email: z.email().transform(value => value.toLowerCase()),
  password,
  name: z.string().trim().min(2).max(100),
}).strict();
export const loginSchema = z.object({ username: z.string().trim().min(1).max(30), password: z.string().min(1).max(72) }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();
