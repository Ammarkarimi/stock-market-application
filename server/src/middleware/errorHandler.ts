import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Malformed JSON bodies and oversized payloads from express.json().
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (status && status >= 400 && status < 500) {
    const type = (err as { type?: string }).type;
    const message = type === 'entity.parse.failed' ? 'Request body is not valid JSON' : (err as Error).message;
    res.status(status).json({ error: { code: 'BAD_REQUEST', message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}
