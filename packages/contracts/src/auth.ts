import { z } from 'zod';
import { IdSchema, IsoDateSchema, IsoDateTimeSchema } from './common';
import { USER_ROLES } from './enums';

export const LoginRequestSchema = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1, 'Password is required').max(200),
  })
  .meta({ id: 'LoginRequest' });
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z
  .object({
    /** Only API clients send this; browsers use the httpOnly refresh cookie. */
    refreshToken: z.string().min(10).max(4096).optional(),
  })
  .meta({ id: 'RefreshRequest' });

export const SessionAuthorSchema = z.object({
  id: IdSchema,
  externalId: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  joinedDate: IsoDateSchema,
});

export const SessionUserSchema = z
  .object({
    id: IdSchema,
    email: z.string(),
    role: z.enum(USER_ROLES),
    displayName: z.string(),
    title: z.string().nullable(),
    author: SessionAuthorSchema.nullable(),
  })
  .meta({ id: 'SessionUser' });
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionResponseSchema = z
  .object({
    user: SessionUserSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Session' });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const TokenResponseSchema = z
  .object({
    tokenType: z.literal('Bearer'),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: IsoDateTimeSchema,
    user: SessionUserSchema,
  })
  .meta({
    id: 'TokenResponse',
    description: 'For API clients (Postman, scripts). Browsers use /auth/login.',
  });
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const DemoAccountSchema = z.object({
  email: z.string(),
  displayName: z.string(),
  role: z.enum(USER_ROLES),
  blurb: z.string(),
});
export const DemoAccountsResponseSchema = z
  .object({
    enabled: z.boolean(),
    password: z.object({ author: z.string(), admin: z.string() }).nullable(),
    accounts: z.array(DemoAccountSchema),
  })
  .meta({ id: 'DemoAccounts' });
export type DemoAccountsResponse = z.infer<typeof DemoAccountsResponseSchema>;
