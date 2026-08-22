import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  checkCombination,
  emptyRateListConfig,
  resolveRateListConfig,
  type CombinationCheckResult,
  type CombinationItemRates,
  type EffectiveRateListConfig,
  type PartyRateListConfig,
  type PartyRateListConfigInput,
  type RateListCategoryConfig,
  type RateListCategoryConfigInput,
  type RateListConfig,
  type RateListConfigInput,
  type RateListConfigBundle,
} from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SCOPE = 'DEFAULT';
const PARTY_SCOPE = 'PARTY';

const norm = (v: unknown): string => String(v ?? '').trim().toUpperCase();

/**
 * Rate List Settings (spec §5, §9, §10, §27).
 *
 * Reads and writes the saved configuration, and validates a price combination
 * before it can be stored (§8). Deliberately separate from CustomersService: the
 * rate list's CONTENT and the rate list's CONFIGURATION are different concerns,
 * and CustomersService is already 1,200 lines of party bookkeeping.
 */
@Injectable()
export class RateListConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /* ── read ──────────────────────────────────────────────────────────────── */

  /** The default configuration, or a permissive one when nothing is saved yet. */
  async getDefault(): Promise<RateListConfig> {
    const row = await this.prisma.rateListConfig.findFirst({ where: { scope: DEFAULT_SCOPE } });
    return row ? this.parseDefault(row.payload) : emptyRateListConfig();
  }

  async listParties(): Promise<PartyRateListConfig[]> {
    const rows = await this.prisma.rateListConfig.findMany({
      where: { scope: PARTY_SCOPE },
      orderBy: { customerId: 'asc' },
    });
    return rows
      .filter((r) => r.customerId != null)
      .map((r) => ({ ...this.parseParty(r.payload), customerId: r.customerId! }));
  }

  /** Everything the settings screen needs, in one round trip. */
  async bundle(): Promise<RateListConfigBundle> {
    const [def, parties, products, designs] = await Promise.all([
      this.getDefault(),
      this.listParties(),
      this.prisma.product.findMany({
        where: { category: { not: '' } },
        select: { category: true, subCategory: true },
        distinct: ['category', 'subCategory'],
        orderBy: [{ category: 'asc' }, { subCategory: 'asc' }],
      }),
      this.prisma.design.findMany({
        where: { category: { not: '' } },
        select: { category: true, subCategory: true },
        distinct: ['category', 'subCategory'],
        orderBy: [{ category: 'asc' }, { subCategory: 'asc' }],
      }),
    ]);
    // Categories come from BOTH masters: a design-only category still needs to be
    // configurable, and taking them from products alone would hide it.
    const categories = [...new Set([...products, ...designs].map((r) => r.category).filter(Boolean))].sort();
    return {
      default: def,
      parties,
      lookups: {
        categories,
        subCategories: products.map((p) => ({ category: p.category, subCategory: p.subCategory })),
        designSubCategories: designs.map((d) => ({ category: d.category, subCategory: d.subCategory })),
      },
    };
  }

  /**
   * The configuration that applies to one party — the default with that party's
   * overrides folded in (§10, §29).
   *
   * This is the call the rate list itself will make, so that "load the saved
   * configuration when the party is selected" happens in one place rather than
   * being reassembled by every consumer.
   */
  async effectiveFor(customerId: number): Promise<EffectiveRateListConfig> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const [def, row] = await Promise.all([
      this.getDefault(),
      this.prisma.rateListConfig.findFirst({ where: { scope: PARTY_SCOPE, customerId } }),
    ]);
    const party = row ? { ...this.parseParty(row.payload), customerId } : null;
    return resolveRateListConfig(def, party);
  }

  /* ── write ─────────────────────────────────────────────────────────────── */

  async saveDefault(input: RateListConfigInput, userName?: string | null): Promise<RateListConfig> {
    const clean = await this.validate(this.sanitiseDefault(input));
    const payload = JSON.stringify(clean);
    const existing = await this.prisma.rateListConfig.findFirst({ where: { scope: DEFAULT_SCOPE } });
    if (existing) {
      await this.prisma.rateListConfig.update({ where: { id: existing.id }, data: { payload, userName: userName ?? null } });
    } else {
      await this.prisma.rateListConfig.create({
        data: { scope: DEFAULT_SCOPE, customerId: null, payload, userName: userName ?? null },
      });
    }
    return clean;
  }

  async saveParty(customerId: number, input: PartyRateListConfigInput, userName?: string | null): Promise<PartyRateListConfig> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Customer not found.');
    const clean = this.sanitiseParty({ ...input, customerId });
    if (clean.categories) await this.validate({ ...emptyRateListConfig(), categories: clean.categories });
    const payload = JSON.stringify(clean);
    const existing = await this.prisma.rateListConfig.findFirst({ where: { scope: PARTY_SCOPE, customerId } });
    if (existing) {
      await this.prisma.rateListConfig.update({ where: { id: existing.id }, data: { payload, userName: userName ?? null } });
    } else {
      await this.prisma.rateListConfig.create({
        data: { scope: PARTY_SCOPE, customerId, payload, userName: userName ?? null },
      });
    }
    return clean;
  }

  /** Drop a party's configuration so it inherits the default again (§29). */
  async clearParty(customerId: number): Promise<void> {
    await this.prisma.rateListConfig.deleteMany({ where: { scope: PARTY_SCOPE, customerId } });
  }

  /* ── §8 combination validation ──────────────────────────────────────────── */

  /**
   * May these sub-categories share one price column? (§8, §28)
   *
   * The rates are read HERE rather than trusted from the client: the point of
   * §8/§28 is that a combination cannot be saved over differing prices, and a
   * check on client-supplied figures is satisfiable by a stale tab.
   *
   * The comparison is per ITEM across the chosen columns — see
   * `checkCombination` in @oms/shared for why "does this sub-category have a
   * rate?" is the wrong question (one GLASS sub-category holds 47 products at 14
   * rates).
   */
  async checkCombination(input: {
    category: string;
    subCategories: string[];
    kind?: 'PRODUCT' | 'DESIGN';
  }): Promise<CombinationCheckResult> {
    const category = norm(input.category);
    if (!category) throw new BadRequestException('Choose the category the combination belongs to.');
    const members = [...new Set((input.subCategories ?? []).map(norm).filter(Boolean))];
    const items = await this.itemRates(category, input.kind ?? 'PRODUCT', members);
    return checkCombination(members, items);
  }

  /**
   * Each item's rate in each of the chosen member columns.
   *
   * Keyed on the item's own name — the product, or the design type — because
   * that is the row of the rate sheet, and the row is what a merged column has
   * to price consistently.
   */
  private async itemRates(
    category: string,
    kind: 'PRODUCT' | 'DESIGN',
    members: string[],
  ): Promise<CombinationItemRates[]> {
    if (!members.length) return [];
    const rows =
      kind === 'DESIGN'
        ? (
            await this.prisma.design.findMany({
              where: { category, showOnRateList: true },
              select: { subCategory: true, designType: true, rate: true },
            })
          ).map((d) => ({ item: d.designType, subCategory: d.subCategory, rate: d.rate }))
        : (
            await this.prisma.product.findMany({
              where: { category, showOnRateList: true },
              select: { subCategory: true, product: true, rate: true },
            })
          ).map((p) => ({ item: p.product, subCategory: p.subCategory, rate: p.rate }));

    const wanted = new Set(members);
    const byItem = new Map<string, Record<string, number>>();
    for (const r of rows) {
      const sub = norm(r.subCategory);
      if (!wanted.has(sub) || r.rate == null) continue;
      const item = String(r.item ?? '').trim();
      if (!item) continue;
      const rec = byItem.get(item) ?? {};
      // Same item listed twice in one sub-category at different rates is itself a
      // conflict; keeping the FIRST would hide it, so keep the one that differs
      // and let the check report it.
      if (rec[sub] == null) rec[sub] = r.rate;
      else if (rec[sub] !== r.rate) rec[sub] = r.rate;
      byItem.set(item, rec);
    }
    return [...byItem.entries()].map(([item, rates]) => ({ item, rates }));
  }

  /* ── parsing / sanitising ───────────────────────────────────────────────── */

  private parseDefault(payload: string): RateListConfig {
    try {
      return this.sanitiseDefault(JSON.parse(payload) as RateListConfigInput);
    } catch {
      // A corrupt row must not take the rate list down with it — fall back to
      // "show everything", which is the pre-settings behaviour.
      return emptyRateListConfig();
    }
  }

  private parseParty(payload: string): PartyRateListConfig {
    try {
      return this.sanitiseParty(JSON.parse(payload) as PartyRateListConfigInput);
    } catch {
      return { customerId: 0 };
    }
  }

  private sanitiseDefault(input: RateListConfigInput): RateListConfig {
    return {
      availableDisplay: input?.availableDisplay === 'SIZE' ? 'SIZE' : 'PCS',
      includeDesigns: input?.includeDesigns !== false,
      categories: this.sanitiseCategories(input?.categories),
    };
  }

  private sanitiseParty(input: PartyRateListConfigInput): PartyRateListConfig {
    const out: PartyRateListConfig = { customerId: Number(input?.customerId) || 0 };
    if (input?.availableDisplay === 'PCS' || input?.availableDisplay === 'SIZE') out.availableDisplay = input.availableDisplay;
    if (typeof input?.includeDesigns === 'boolean') out.includeDesigns = input.includeDesigns;
    if (Array.isArray(input?.categories) && input.categories.length) out.categories = this.sanitiseCategories(input.categories);
    return out;
  }

  /** Upper-case everything, drop blanks, and de-duplicate — so a config saved
   *  with "glass" matches a product master that says "GLASS". */
  private sanitiseCategories(list: RateListCategoryConfigInput[] | RateListCategoryConfig[] | null | undefined): RateListCategoryConfig[] {
    const out: RateListCategoryConfig[] = [];
    const seen = new Set<string>();
    for (const c of list ?? []) {
      const category = norm(c?.category);
      if (!category || seen.has(category)) continue;
      seen.add(category);
      out.push({
        category,
        included: c?.included !== false,
        subCategories: [...new Set((c?.subCategories ?? []).map(norm).filter(Boolean))],
        availableDisplay: c?.availableDisplay === 'PCS' || c?.availableDisplay === 'SIZE' ? c.availableDisplay : null,
        combinations: (c?.combinations ?? [])
          .map((cb, i) => ({
            id: String(cb?.id ?? `c${i + 1}`),
            label: String(cb?.label ?? '').trim(),
            members: [...new Set((cb?.members ?? []).map(norm).filter(Boolean))],
          }))
          .filter((cb) => cb.members.length >= 2),
      });
    }
    return out.sort((a, b) => a.category.localeCompare(b.category));
  }

  /**
   * Re-check every stored combination against the live rates (§8, §28).
   *
   * Run on SAVE, not only when a combination is created: rates move afterwards,
   * and a combination that was valid when it was made can become a column hiding
   * two prices without anybody touching it. Refusing the save is the only moment
   * this can be caught with the user present to fix it.
   */
  private async validate(config: RateListConfig): Promise<RateListConfig> {
    for (const cat of config.categories) {
      for (const cb of cat.combinations) {
        const res = await this.checkCombination({ category: cat.category, subCategories: cb.members });
        if (!res.ok) {
          const name = cb.label || cb.members.join(' + ');
          throw new BadRequestException(`${cat.category} — combination "${name}" cannot be saved. ${res.message}`);
        }
      }
      // A combination member that is not an included sub-category would title a
      // column over something the sheet does not show.
      if (cat.subCategories.length) {
        for (const cb of cat.combinations) {
          const stray = cb.members.filter((m) => !cat.subCategories.includes(m));
          if (stray.length) {
            throw new BadRequestException(
              `${cat.category} — combination "${cb.label || cb.members.join(' + ')}" includes ${stray.join(', ')}, ` +
                'which is not among the sub-categories selected for this category.',
            );
          }
        }
      }
    }
    return config;
  }
}
