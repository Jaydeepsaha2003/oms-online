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
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ExcelService } from '../excel/excel.service';
import { ProductsService } from './products.service';
import {
  CreateProductDto,
  ImportProductsDto,
  ProductQueryDto,
  SetCategoryFieldsDto,
  UpdateProductDto,
} from './dto/product.dto';

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

  @Get('category-fields')
  @Permissions(perm(R, ACTIONS.VIEW))
  categoryFields() {
    return this.products.getCategoryFields();
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
