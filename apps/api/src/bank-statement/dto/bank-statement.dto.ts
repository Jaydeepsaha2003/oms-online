import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

/** Which column of the uploaded sheet holds what — see BankStatementColumnMap. */
export class ColumnMapDto {
  @IsString() @MaxLength(200) date!: string;
  @IsString() @MaxLength(200) narration!: string;
  @IsString() @MaxLength(200) credit!: string;
  @IsOptional() @IsString() @MaxLength(200) debit?: string | null;
  @IsOptional() @IsString() @MaxLength(200) ref?: string | null;
}

export class BankStatementCreateDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsOptional() @IsString() @MaxLength(255) bankName?: string | null;
  @IsString() fromDate!: string;
  @IsString() toDate!: string;

  @ValidateNested()
  @Type(() => ColumnMapDto)
  map!: ColumnMapDto;

  /**
   * The sheet's data rows as `{ column: cell }`.
   *
   * Sent from the browser, which already read the file with the same helper
   * every other import uses. Filtering to credits inside the range is done on
   * the server so that rule lives in exactly one place.
   */
  @IsArray()
  @ArrayNotEmpty({ message: 'The file has no rows.' })
  rows!: Record<string, string | null>[];
}

export class BankStatementAssignDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one line.' })
  @IsInt({ each: true })
  rowIds!: number[];

  /** null clears the party, putting the line back in the unassigned pile. */
  @IsOptional() @IsInt() customerId?: number | null;

  @IsOptional() @IsBoolean() rememberAlias?: boolean;
}

export class BankStatementIgnoreDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one line.' })
  @IsInt({ each: true })
  rowIds!: number[];

  @IsOptional() @IsBoolean() ignored?: boolean;
}

export class BankStatementRunsQueryDto extends PaginationDto {}
