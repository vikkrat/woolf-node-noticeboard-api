import 'dotenv/config';

/** Fail at startup rather than signing tokens with an absent or placeholder secret. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be configured in .env`);
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  port: Number(process.env.PORT ?? 3000),
};
if (config.jwtSecret.length < 32 || config.jwtSecret.startsWith('replace-with')) {
  throw new Error('JWT_SECRET must be a random secret of at least 32 characters.');
}
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}
