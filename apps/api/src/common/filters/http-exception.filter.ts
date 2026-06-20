import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@oms/shared';

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
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(exception.message, exception.stack);
    }

    if (statusCode >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${statusCode}: ${message}`);
    }

    const payload: ApiError = {
      success: false,
      statusCode,
      message,
      error,
      details,
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(payload);
  }
}
