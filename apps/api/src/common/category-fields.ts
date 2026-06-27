import type { CategoryFieldDto } from '@oms/shared';
import type { PrismaService } from '../prisma/prisma.service';

/** AppConfig key holding the category → price-calc-field map (JSON object). */
const KEY = 'CATEGORY_CALC_FIELDS';

const normField = (f: unknown): 'KGS' | 'PCS' => (String(f).toUpperCase() === 'PCS' ? 'PCS' : 'KGS');

/** Read the per-category price-calc field map. */
export async function readCategoryFields(prisma: PrismaService): Promise<CategoryFieldDto[]> {
  const row = await prisma.appConfig.findUnique({ where: { key: KEY } });
  if (!row?.value) return [];
  try {
    const obj = JSON.parse(row.value) as Record<string, string>;
    return Object.entries(obj)
      .map(([category, field]) => ({ category, field: normField(field) }))
      .sort((a, b) => a.category.localeCompare(b.category));
  } catch {
    return [];
  }
}

/** Replace the whole category → field map (categories upper-cased, de-duplicated). */
export async function writeCategoryFields(
  prisma: PrismaService,
  list: { category?: string; field?: string }[],
): Promise<CategoryFieldDto[]> {
  const obj: Record<string, string> = {};
  for (const { category, field } of list ?? []) {
    const c = (category ?? '').trim().toUpperCase();
    if (c) obj[c] = normField(field);
  }
  const value = JSON.stringify(obj);
  await prisma.appConfig.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
  return readCategoryFields(prisma);
}
