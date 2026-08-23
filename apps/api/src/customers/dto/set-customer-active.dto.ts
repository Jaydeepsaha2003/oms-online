import { IsBoolean } from 'class-validator';

/**
 * The whole payload for flipping a customer's Active flag.
 *
 * A one-field DTO on purpose: `UpdateCustomerDto` looks partial but is applied
 * as a full overwrite (see CustomersService.setActive), so a narrow action gets
 * a narrow contract that cannot carry anything else along with it.
 */
export class SetCustomerActiveDto {
  @IsBoolean() active!: boolean;
}
