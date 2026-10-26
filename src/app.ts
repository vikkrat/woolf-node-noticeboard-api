import express from 'express';
import type { ErrorRequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { authRouter } from './routes/auth.routes.ts';
import { announcementsRouter } from './routes/announcements.routes.ts';
import { generateOpenApiDocument } from './openapi.ts';

/** Build the HTTP application separately from listening so tests can use an ephemeral port. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/auth', authRouter);
  app.use('/announcements', announcementsRouter);
  const document = generateOpenApiDocument();
  app.get('/openapi.json', (_req, res) => res.json(document));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(document, { customSiteTitle: 'NoticeBoard API | API Reference' }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  // Express 5 forwards rejected async handlers here without custom promise wrappers.
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error.type === 'entity.parse.failed') { res.status(400).json({ error: 'Validation failed', details: [{ field: 'body', message: 'Invalid JSON format in request body' }] }); return; }
    if (error.code === 'P2002') { res.status(409).json({ error: 'Username or email already taken' }); return; }
    if (error.code === 'P2025') { res.status(404).json({ error: 'Resource not found' }); return; }
    if (error.code === 'P2003') { res.status(400).json({ error: 'Related resource not found' }); return; }
    if (error.status >= 400 && error.status < 500) { res.status(error.status).json({ error: error.message }); return; }
    console.error('Unhandled request error:', error.name ?? 'Error');
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);
  return app;
}
