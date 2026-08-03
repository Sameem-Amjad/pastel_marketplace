import { Request } from 'express';

/**
 * Read a single cookie value off the raw Cookie header (we don't pull in cookie-parser for one lookup).
 * Shared by AuthGuard (reads pa_at) and AuthController (reads pa_rt) — was duplicated in both (AUDIT H3).
 */
export function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx !== -1 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}
