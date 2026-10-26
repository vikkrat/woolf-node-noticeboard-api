import { Router } from 'express';
import * as announcements from '../controllers/announcements.controller.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.ts';
import { announcementSchema, updateSchema, idSchema, querySchema } from '../validators/announcements.validator.ts';

export const announcementsRouter = Router();
announcementsRouter.get('/', validateQuery(querySchema), announcements.list);
announcementsRouter.get('/:id', validateParams(idSchema), announcements.get);
announcementsRouter.post('/', authenticate, validateBody(announcementSchema), announcements.create);
announcementsRouter.patch('/:id', authenticate, validateParams(idSchema), validateBody(updateSchema), announcements.update);
announcementsRouter.delete('/:id', authenticate, validateParams(idSchema), announcements.remove);
