import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ERROR_CODES } from '@pharmacy/shared';
import { ZodError } from 'zod';
import { AppError, isAppError } from '../lib/errors.js';
import { isProduction } from '../env.js';

/** 404 fallback for unmatched routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `المسار غير موجود: ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
}

function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): AppError {
  switch (error.code) {
    case 'P2002': {
      const target = (error.meta?.target as string[] | string | undefined) ?? [];
      const fields = Array.isArray(target) ? target.join(', ') : String(target);
      return new AppError(`قيمة مكررة: ${fields}`, {
        statusCode: 409,
        code: ERROR_CODES.CONFLICT,
        details: { target: fields },
      });
    }
    case 'P2003':
      return new AppError('مرجع غير موجود (علاقة غير صحيحة)', {
        statusCode: 409,
        code: ERROR_CODES.CONFLICT,
        details: error.meta,
      });
    case 'P2025':
      return new AppError('العنصر غير موجود', { statusCode: 404, code: ERROR_CODES.NOT_FOUND });
    case 'P2014':
      return new AppError('لا يمكن تنفيذ العملية بسبب ارتباطات موجودة', {
        statusCode: 409,
        code: ERROR_CODES.CONFLICT,
      });
    default:
      return new AppError('خطأ في قاعدة البيانات', {
        statusCode: 500,
        code: ERROR_CODES.INTERNAL,
        details: { prismaCode: error.code },
        expose: false,
      });
  }
}

/** Terminal error middleware. Always returns the shared error envelope. */
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let appError: AppError;

  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError('بيانات غير صحيحة', {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      details: error.issues,
    });
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    appError = mapPrismaError(error);
  } else if (error instanceof Prisma.PrismaClientValidationError) {
    appError = new AppError('طلب غير صالح لقاعدة البيانات', {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
      expose: false,
    });
  } else if (error instanceof SyntaxError && 'body' in error) {
    appError = new AppError('صيغة JSON غير صحيحة', {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  } else {
    appError = new AppError('حدث خطأ غير متوقع في الخادم', {
      statusCode: 500,
      code: ERROR_CODES.INTERNAL,
      expose: false,
    });
  }

  if (appError.statusCode >= 500) {
    req.log?.error({ err: error }, 'unhandled request error');
  } else {
    req.log?.warn({ err: appError.message, code: appError.code }, 'request rejected');
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      requestId: req.requestId,
      ...(!isProduction && !appError.expose && error instanceof Error
        ? { debug: error.message }
        : {}),
    },
  });
};
