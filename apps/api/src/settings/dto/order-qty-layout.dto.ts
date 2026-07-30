import { IsArray, IsObject, IsOptional } from 'class-validator';
import type { OrderQtyLayout, QtyField } from '@oms/shared';

/** Body for PUT /settings/order-qty-layout. The service sanitises the contents
 *  (normalises each list to the four fields, upper-cases category keys), so the
 *  validation here only guards the coarse shape. */
export class UpdateOrderQtyLayoutDto implements OrderQtyLayout {
  @IsOptional() @IsArray() default!: QtyField[];
  @IsOptional() @IsObject() byCategory!: Record<string, QtyField[]>;
}
