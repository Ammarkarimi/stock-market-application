import type { NextFunction, Request, Response } from 'express';

/** Compact access log for API calls (skips the live price polls). */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  // Browsers poll /api/live every few seconds; logging each poll would drown everything else.
  if (req.path === '/api/live') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}
