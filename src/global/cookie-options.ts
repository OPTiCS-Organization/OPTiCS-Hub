import { CookieOptions } from 'express';

export function cookieOptions(): CookieOptions {
  const isProd = process.env.RUNNING_MODE === 'PRODUCTION';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
  };
}
