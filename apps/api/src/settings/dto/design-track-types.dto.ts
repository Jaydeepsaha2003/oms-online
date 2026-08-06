import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Which design types Design Track is allowed to show. An empty list is valid —
 *  it means nothing is tracked, and the grid is empty by design. */
export class UpdateDesignTrackTypesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  selected!: string[];
}
