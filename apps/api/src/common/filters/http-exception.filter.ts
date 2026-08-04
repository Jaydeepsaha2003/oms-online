import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError, DuplicateMatch } from '@oms/shared';

/**
 * Converts any thrown error into the standard `ApiError` envelope so the web
 * client always receives a predictable shape. Extracts class-validator field
 * errors into `details`.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | undefined;
    let details: Record<string, string[]> | undefined;
    let duplicate: DuplicateMatch | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (res && typeof res === 'object') {
        const body = res as Record<string, unknown>;
        error = (body.error as string) ?? exception.name;
        const rawMessage = body.message;
        if (Array.isArray(rawMessage)) {
          // class-validator produces an array of messages.
          message = 'Validation failed';
          error = 'VALIDATION_ERROR';
          details = { _: rawMessage as string[] };
        } else if (typeof rawMessage === 'string') {
          message = rawMessage;
        }
        // A duplicate conflict carries the matched record so the client can
        // offer "open the existing one" rather than just refusing the save.
        if (body.duplicate) duplicate = body.duplicate as DuplicateMatch;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack);
    }

    if (statusCode >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${statusCode}: ${message}`);
    } else if (statusCode >= 400 && statusCode !== 401) {
      // 4xx used to be silent, which made a client-reported "it just says error
      // 400" impossible to diagnose from the server side. Log the reason —
      // including the class-validator field errors, which are the whole point of
      // a 400 and are otherwise buried in `details`. 401 is skipped: the token
      // refresh flow produces them routinely and they'd drown out the rest.
      const fields = details?._?.length ? ` · ${details._.join('; ')}` : '';
      this.logger.warn(`${request.method} ${request.url} → ${statusCode}: ${message}${fields}`);
    }

    const payload: ApiError = {
      success: false,
      statusCode,
      message,
      error,
      details,
      duplicate,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(payload);
  }
}
