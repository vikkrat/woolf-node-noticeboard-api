import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/** Store parsed values in locals: Express 5 exposes req.query as a read-only getter. */
function validate(source: 'body' | 'params' | 'query', schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message })) });
      return;
    }
    res.locals[source] = result.data;
    next();
  };
}

/** Validate JSON request payloads and retain only schema-approved data. */
export const validateBody = (schema: ZodType) => validate('body', schema);
/** Validate route parameters before passing IDs to Prisma. */
export const validateParams = (schema: ZodType) => validate('params', schema);
/** Validate search, pagination and sorting options. */
export const validateQuery = (schema: ZodType) => validate('query', schema);
