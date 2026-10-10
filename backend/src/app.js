import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import analyticsRoutes from './routes/analytics.js';
import auditRoutes from './routes/auditLogs.js';
import authRoutes from './routes/auth.js';
import encounterRoutes from './routes/encounters.js';
import eventRoutes from './routes/events.js';
import metaRoutes from './routes/meta.js';
import patientRoutes from './routes/patients.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind exactly one proxy (Render / a load balancer): use its X-Forwarded-For for req.ip.
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // Only force HTTPS when we are actually served over HTTPS.
          upgradeInsecureRequests: config.cookieSecure ? [] : null,
        },
      },
      strictTransportSecurity: config.cookieSecure,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      skip: () => config.env === 'test',
    }),
  );
  // Clinical responses must never sit in browser or proxy caches.
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });
  api.use('/auth', authRoutes);
  api.use(authenticate); // everything below requires a valid access token
  api.use('/meta', metaRoutes);
  api.use('/patients', patientRoutes);
  api.use('/encounters', encounterRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/audit-logs', auditRoutes);
  api.use('/users', userRoutes);
  api.use('/events', eventRoutes);
  api.use(notFoundHandler);
  app.use('/api', api);

  // In production the built React app is served from the same origin, so no
  // CORS is needed and the refresh cookie can be SameSite=Strict.
  const staticDir = config.staticDir && path.resolve(config.staticDir);
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
