import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { env, isProduction } from './env.js';
import { accessLog, requestContext } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/auth/users.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { cashdrawerRouter } from './modules/cashdrawer/cashdrawer.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { customersRouter } from './modules/customers/customers.routes.js';
import { debtsRouter } from './modules/debts/debts.routes.js';
import { expensesRouter } from './modules/expenses/expenses.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { suppliersRouter } from './modules/suppliers/suppliers.routes.js';
import { warehousesRouter } from './modules/warehouses/warehouses.routes.js';
import { buildOpenApiDocument, renderDocsPage } from './openapi.js';

function corsOptions(): CorsOptions {
  const configured = env.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      // Native clients (Electron main process, curl, tests) send no Origin.
      if (!origin) return callback(null, true);
      if (!isProduction || configured.includes('*') || configured.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin not allowed: ${origin}`));
    },
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-ratelimit-remaining', 'retry-after'],
  };
}

/** Builds the fully-wired Express application (no I/O side effects). */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(
    helmet({
      // The API is consumed by a desktop client, not a browser page, so the
      // browser-oriented CSP/cross-origin policies are relaxed — except for the
      // built-in documentation page which gets its own strict policy below.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors(corsOptions()));
  app.use(express.json({ limit: '2mb' }));
  app.use(requestContext);
  app.use(accessLog);

  // Liveness/readiness at the root for infrastructure probes.
  app.use('/', healthRouter);

  app.get('/api/openapi.json', (_req, res) => {
    res.status(200).json(buildOpenApiDocument());
  });
  app.get('/api/docs', (_req, res) => {
    res
      .status(200)
      .setHeader('content-type', 'text/html; charset=utf-8')
      .setHeader(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      )
      .send(renderDocsPage());
  });

  const v1 = express.Router();
  v1.use('/auth', authRouter);
  v1.use('/users', usersRouter);
  v1.use('/products', productsRouter);
  v1.use('/cashdrawer', cashdrawerRouter);
  v1.use('/categories', categoriesRouter);
  v1.use('/suppliers', suppliersRouter);
  v1.use('/warehouses', warehousesRouter);
  v1.use('/inventory', inventoryRouter);
  v1.use('/purchases', purchasesRouter);
  v1.use('/sales', salesRouter);
  v1.use('/customers', customersRouter);
  v1.use('/debts', debtsRouter);
  v1.use('/expenses', expensesRouter);
  v1.use('/reports', reportsRouter);
  v1.use('/audit', auditRouter);

  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
