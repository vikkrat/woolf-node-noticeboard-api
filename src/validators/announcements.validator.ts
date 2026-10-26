import { z } from 'zod';

export const announcementSchema = z.object({
  title: z.string().trim().min(5).max(50),
  description: z.string().trim().min(10).max(10000),
  price: z.number().positive().finite(),
  category: z.enum(['sale', 'service', 'job', 'other']),
}).strict();
export const updateSchema = announcementSchema.partial().refine(value => Object.keys(value).length > 0, 'At least one field is required');
// Accept decimal digits only: reject fractions, scientific notation and repeated query arrays.
const positiveInteger = z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647));
export const idSchema = z.object({ id: positiveInteger });
export const querySchema = z.object({
  page: positiveInteger.default(1),
  search: z.string().trim().max(200).default(''),
  sort: z.enum(['newest', 'oldest']).default('newest'),
}).strict();
