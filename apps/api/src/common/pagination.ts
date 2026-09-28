import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PAGE_SIZES } from '@osooli/shared';

const toInt = ({ value }: { value: unknown }) => (value === undefined || value === '' ? undefined : Number(value));

/** Server-side paging/sorting/search query (spec §41, §70). */
export class ListQueryDto {
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(toInt)
  @IsIn(PAGE_SIZES as unknown as number[])
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paging(query: ListQueryDto): { skip: number; take: number; page: number; pageSize: number } {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 25;
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

/** Maps a client sort key to an allowed Prisma orderBy; unknown keys fall back to the default. */
export function orderBy<O>(
  query: ListQueryDto,
  allowed: Record<string, (dir: 'asc' | 'desc') => O>,
  fallback: string,
): O {
  const key = query.sort && Object.hasOwn(allowed, query.sort) ? query.sort : fallback;
  return allowed[key](query.order ?? 'asc');
}
