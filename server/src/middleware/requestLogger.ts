import type { NextFunction, Request, Response } from 'express';

/** Compact access log for API calls (skips the long-lived event stream). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/api/stream') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}
