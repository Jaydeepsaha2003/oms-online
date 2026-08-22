import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { AnyPermission, Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExcelService } from '../excel/excel.service';
import { ProductsService } from './products.service';
import {
  BulkSetProductFlagsDto,
  CreateProductDto,
  ImportProductsDto,
  ProductQueryDto,
  SetCategoryFieldsDto,
  SetProductFlagsDto,
  UpdateProductDto,
} from './dto/product.dto';
import { ProductPhotoQueryDto } from './dto/product-photo.dto';

const R = RESOURCES.PRODUCT;

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: ProductQueryDto) {
    return this.products.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.products.lookups();
  }

  /** Recent product edits, newest first (§6.1). Declared ABOVE `:id` so
   *  "changes" is not parsed as a product id. */
  @Get('changes')
  @Permissions(perm(R, ACTIONS.VIEW))
  recentChanges(@Query('productId') productId?: string) {
    const id = productId ? Number(productId) : undefined;
    return this.products.recentChanges(Number.isFinite(id) ? id : undefined);
  }

  @Get('category-fields')
  @Permissions(perm(R, ACTIONS.VIEW))
  categoryFields() {
    return this.products.getCategoryFields();
  }

  // ── Photo gallery (Products → Product Photos) ──────────────────────────────
  //
  // The photos live on order lines, so an order viewer is admitted too: the same
  // rows they can already reach one line at a time from Order Modify, only
  // grouped the other way round. Both are read-only here — uploading and
  // deleting stay on the screens that own the line.
  //
  // Declared ABOVE ':id' so "photos" is matched as a route, not parsed as a
  // product id (which would 400 on the ParseIntPipe).
  @Get('photos')
  @AnyPermission(perm(R, ACTIONS.VIEW), perm(RESOURCES.ORDER, ACTIONS.VIEW))
  photoGallery(@Query() query: ProductPhotoQueryDto) {
    return this.products.photoGallery(query);
  }

  @Get('photos/filter-options')
  @AnyPermission(perm(R, ACTIONS.VIEW), perm(RESOURCES.ORDER, ACTIONS.VIEW))
  photoFilterOptions(@Query() query: ProductPhotoQueryDto) {
    return this.products.photoFilterOptions(query);
  }

  @Put('category-fields')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Updated category price fields' })
  setCategoryFields(@Body() dto: SetCategoryFieldsDto) {
    return this.products.setCategoryFields(dto.fields);
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported products' })
  async export(@Query() query: ProductQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.products.exportRows(query);
    this.excel.setDownloadHeaders(res, 'products');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, { sheetName: 'Products', headers: this.products.exportHeaders() }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported products' })
  import(@Body() dto: ImportProductsDto) {
    return this.products.importRows(dto);
  }

  /** Bulk row-selection actions (e.g. "deactivate the ticked products"). Declared
   *  before the `:id` routes so it isn't swallowed as a (non-numeric) id param. */
  @Patch('bulk-flags')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Bulk-toggled product active / rate-list flag' })
  bulkSetFlags(@Body() dto: BulkSetProductFlagsDto) {
    const { ids, ...flags } = dto;
    return this.products.bulkSetFlags(ids, flags);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.products.findOne(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id/flags')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R, description: 'Toggled product active / rate-list flag' })
  setFlags(@Param('id', ParseIntPipe) id: number, @Body() dto: SetProductFlagsDto) {
    return this.products.setFlags(id, dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto, @CurrentUser('name') userName: string) {
    return this.products.update(id, dto, userName);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.products.remove(id);
    return { ok: true };
  }
}
