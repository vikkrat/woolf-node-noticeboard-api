import { Router } from 'express';
import * as auth from '../controllers/auth.controller.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { validateBody } from '../middleware/validate.ts';
import { registerSchema, loginSchema, refreshSchema } from '../validators/auth.validator.ts';

export const authRouter = Router();
authRouter.post('/register', validateBody(registerSchema), auth.register);
authRouter.post('/login', validateBody(loginSchema), auth.login);
authRouter.post('/refresh', validateBody(refreshSchema), auth.refresh);
authRouter.post('/logout', authenticate, auth.logout);
authRouter.get('/me', authenticate, auth.me);
