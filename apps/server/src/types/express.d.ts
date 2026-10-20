import type { Role } from '@pharmacy/shared';
import type { Logger } from '../logger.js';

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Correlation id echoed in responses and logs. */
      requestId: string;
      /** Request-scoped child logger. */
      log: Logger;
      /** Set by the `authenticate` middleware. */
      user?: AuthenticatedUser;
    }
  }
}

export {};
