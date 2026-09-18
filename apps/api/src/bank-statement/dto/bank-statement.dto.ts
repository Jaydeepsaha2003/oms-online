import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
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
  /** 'ask' (default) reports lines already held and creates nothing. */
  @IsOptional() @IsIn(['ask', 'skip', 'import']) onDuplicate?: 'ask' | 'skip' | 'import';

  /** The user has seen the cheques this statement ends too soon to vouch for,
   *  and said to load them anyway. Absent means ask. */
  @IsOptional() @IsBoolean() acceptUncleared?: boolean;
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

export class BankStatementReverseDto {
  /** The POSTED statement line whose receipt is to be reversed. */
  @IsInt() rowId!: number;
}

export class BankStatementClearPartyDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one line.' })
  @IsInt({ each: true })
  rowIds!: number[];

  /** Also delete the narration alias these lines taught. Defaults to false —
   *  forgetting affects every future statement, so it is opted into, never
   *  assumed from a plain "clear this line". */
  @IsOptional() @IsBoolean() forgetAlias?: boolean;
}

export class BankStatementIgnoreDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'Select at least one line.' })
  @IsInt({ each: true })
  rowIds!: number[];

  @IsOptional() @IsBoolean() ignored?: boolean;
}

/**
 * Which lines Process should post.
 *
 * Omitted (or empty) means every unmatched line, which is the ordinary case and
 * the behaviour this screen has always had. Supplying ids narrows it to the
 * ticked ones — the status filter still applies on the server, so a tick can
 * choose among the postable lines but never make an unpostable one post.
 */
export class BankStatementProcessDto {
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  rowIds?: number[];
}

export class BankStatementRunsQueryDto extends PaginationDto {}
