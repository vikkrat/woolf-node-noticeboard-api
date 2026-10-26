import { extendZodWithOpenApi, OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { registerSchema, loginSchema, refreshSchema } from './validators/auth.validator.ts';
import { announcementSchema, updateSchema } from './validators/announcements.validator.ts';

extendZodWithOpenApi(z);
export const registry = new OpenAPIRegistry();
registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
const security = [{ bearerAuth: [] }];
const user = registry.register('User', z.object({ id: z.number().int(), username: z.string(), email: z.email(), name: z.string() }));
const tokens = registry.register('TokenPair', z.object({ accessToken: z.string(), refreshToken: z.string() }));
const authResponse = tokens.extend({ user });
const announcement = registry.register('Announcement', announcementSchema.extend({ id: z.number().int(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), user }));
const error = z.object({ error: z.string(), details: z.array(z.object({ field: z.string(), message: z.string() })).optional() });

/** Share JSON response definitions while keeping every route explicitly registered. */
const json = (schema: z.ZodType, description: string) => ({ description, content: { 'application/json': { schema } } });
const body = (schema: z.ZodType) => ({ required: true, content: { 'application/json': { schema } } });
const errors = { 400: json(error, 'Validation failed'), 401: json(error, 'Missing, invalid or expired token') };
const params = z.object({ id: z.string().regex(/^[1-9]\d*$/).openapi({ example: '1' }) });

registry.registerPath({ method: 'post', path: '/auth/register', tags: ['Authentication'], summary: 'Create an account', request: { body: body(registerSchema) }, responses: { 201: json(authResponse, 'Account and token pair created'), 400: errors[400], 409: json(error, 'Username or email already taken') } });
registry.registerPath({ method: 'post', path: '/auth/login', tags: ['Authentication'], summary: 'Sign in and replace the refresh session', request: { body: body(loginSchema) }, responses: { 200: json(authResponse, 'Authenticated'), ...errors } });
registry.registerPath({ method: 'post', path: '/auth/refresh', tags: ['Authentication'], summary: 'Rotate a refresh token once', request: { body: body(refreshSchema) }, responses: { 200: json(tokens, 'New token pair'), ...errors } });
registry.registerPath({ method: 'post', path: '/auth/logout', tags: ['Authentication'], summary: 'Revoke refresh session', description: 'Access tokens remain valid until their 15-minute expiration.', security, responses: { 204: { description: 'Logged out; no response body' }, 401: errors[401] } });
registry.registerPath({ method: 'get', path: '/auth/me', tags: ['Authentication'], summary: 'Read your profile', security, responses: { 200: json(user.extend({ createdAt: z.iso.datetime() }), 'Current user'), 401: errors[401] } });

registry.registerPath({ method: 'get', path: '/announcements', tags: ['Announcements'], summary: 'Browse, search and paginate', request: { query: z.object({ page: z.coerce.number().int().min(1).default(1), search: z.string().default(''), sort: z.enum(['newest', 'oldest']).default('newest') }) }, responses: { 200: json(z.object({ data: z.array(announcement), pagination: z.object({ total: z.number().int(), page: z.number().int(), totalPages: z.number().int(), perPage: z.literal(10) }) }), 'Paginated announcements'), 400: errors[400] } });
registry.registerPath({ method: 'get', path: '/announcements/{id}', tags: ['Announcements'], summary: 'Read one announcement', request: { params }, responses: { 200: json(announcement, 'Announcement with public author'), 400: errors[400], 404: json(error, 'Announcement not found') } });
registry.registerPath({ method: 'post', path: '/announcements', tags: ['Announcements'], summary: 'Publish an announcement', security, request: { body: body(announcementSchema) }, responses: { 201: json(announcement, 'Announcement created'), ...errors } });
registry.registerPath({ method: 'patch', path: '/announcements/{id}', tags: ['Announcements'], summary: 'Edit your own announcement', security, request: { params, body: body(updateSchema) }, responses: { 200: json(announcement, 'Announcement updated'), ...errors, 403: json(error, 'Access denied'), 404: json(error, 'Announcement not found') } });
registry.registerPath({ method: 'delete', path: '/announcements/{id}', tags: ['Announcements'], summary: 'Delete your own announcement', security, request: { params }, responses: { 204: { description: 'Deleted; no response body' }, ...errors, 403: json(error, 'Access denied'), 404: json(error, 'Announcement not found') } });

/** Generate documentation from the route registry and the same request schemas used at runtime. */
export function generateOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.0', info: { title: 'NoticeBoard API', version: '1.0.0', description: 'A JSON API for community announcements, with JWT authentication and author-only editing.' },
    servers: [{ url: '/', description: 'Current server' }],
  });
}
