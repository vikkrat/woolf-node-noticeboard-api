import type { RequestHandler } from 'express';
import prisma from '../../prisma/client.ts';
import { HttpError } from '../errors.ts';
import { publicUser } from './auth.controller.ts';

const include = { user: { select: publicUser } };
// Internal foreign keys stay in the database; the public API returns the author object.
const omit = { userId: true } as const;

/** Use the same filter for count and data, with a stable ID tie-breaker for equal timestamps. */
export const list: RequestHandler = async (_req, res) => {
  const { page, search, sort } = res.locals.query;
  // Escape SQL LIKE metacharacters so search means a literal substring, including % and _.
  const escaped = search.replace(/[\\%_]/g, '\\$&');
  const where = search ? { title: { contains: escaped, mode: 'insensitive' as const } } : {};
  const direction = sort === 'oldest' ? 'asc' : 'desc';
  const [total, data] = await prisma.$transaction([
    prisma.announcement.count({ where }),
    prisma.announcement.findMany({ where, include, omit, skip: (page - 1) * 10, take: 10, orderBy: [{ createdAt: direction }, { id: direction }] }),
  ], { isolationLevel: 'RepeatableRead' });
  res.json({ data, pagination: { total, page, totalPages: Math.ceil(total / 10), perPage: 10 } });
};

/** Public lookup: Prisma findUnique returns null, so explicitly produce a 404. */
export const get: RequestHandler = async (_req, res) => {
  const announcement = await prisma.announcement.findUnique({ where: { id: res.locals.params.id }, include, omit });
  if (!announcement) throw new HttpError(404, 'Announcement not found');
  res.json(announcement);
};

/** Derive authorship only from the verified access token, never from request JSON. */
export const create: RequestHandler = async (req, res) => {
  const announcement = await prisma.announcement.create({ data: { ...res.locals.body, userId: req.user!.sub }, include, omit });
  res.status(201).json(announcement);
};

/** Verify existence before ownership to distinguish missing resources from forbidden actions. */
async function requireOwner(id: number, userId: number) {
  const announcement = await prisma.announcement.findUnique({ where: { id }, select: { userId: true } });
  if (!announcement) throw new HttpError(404, 'Announcement not found');
  if (announcement.userId !== userId) throw new HttpError(403, 'Access denied');
}

/** Apply validated partial fields; Prisma updates updatedAt automatically. */
export const update: RequestHandler = async (req, res) => {
  const id = res.locals.params.id;
  await requireOwner(id, req.user!.sub);
  res.json(await prisma.announcement.update({ where: { id, userId: req.user!.sub }, data: res.locals.body, include, omit }));
};

/** Delete only the authenticated author's record and finish with an empty 204 response. */
export const remove: RequestHandler = async (req, res) => {
  const id = res.locals.params.id;
  await requireOwner(id, req.user!.sub);
  await prisma.announcement.delete({ where: { id, userId: req.user!.sub } });
  res.status(204).end();
};
