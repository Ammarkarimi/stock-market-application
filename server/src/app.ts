import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { Router } from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { requireAuth } from './middleware/auth.js';
import { loadSession } from './middleware/auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import authRoutes from './routes/auth.routes.js';
import profileRoutes from './routes/profile.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (!config.isTest) app.use(requestLogger);

  const api = Router();
  api.use(apiLimiter);
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(loadSession);
  api.use(csrfProtection);
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });
  api.use('/auth', authRoutes);
  api.use('/profile', requireAuth, profileRoutes);
  api.use(notFoundHandler);

  app.use('/api', api);

  // In production the API also serves the built single-page app.
  if (fs.existsSync(path.join(config.clientDistPath, 'index.html'))) {
    app.use(express.static(config.clientDistPath, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.clientDistPath, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
