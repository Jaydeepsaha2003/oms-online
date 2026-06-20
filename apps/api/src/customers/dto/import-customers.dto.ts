import { IsArray } from 'class-validator';

/** Rows parsed from an uploaded spreadsheet (keyed by the legacy column headers). */
export class ImportCustomersDto {
  @IsArray()
  rows!: Record<string, unknown>[];
}
