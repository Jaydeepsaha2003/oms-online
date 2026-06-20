import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiResponse } from '@oms/shared';

/**
 * Wraps successful JSON responses in the standard `{ success: true, data }`
 * envelope. File/stream/empty responses (Excel & PDF downloads) pass through
 * untouched.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T> | T> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T> | T> {
    return next.handle().pipe(
      map((data) => {
        if (data === undefined) return data as T;
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) return data as T;
        return { success: true, data } as ApiResponse<T>;
      }),
    );
  }
}
