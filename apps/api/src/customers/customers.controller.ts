import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ACTIONS, perm, RESOURCES } from '@oms/shared';
import { Audit } from '../common/decorators/audit.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExcelService } from '../excel/excel.service';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { ImportCustomersDto } from './dto/import-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const R = RESOURCES.CUSTOMER;

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly excel: ExcelService,
  ) {}

  @Get()
  @Permissions(perm(R, ACTIONS.VIEW))
  list(@Query() query: CustomerQueryDto) {
    return this.customers.findMany(query);
  }

  @Get('lookups')
  @Permissions(perm(R, ACTIONS.VIEW))
  lookups() {
    return this.customers.lookups();
  }

  @Get('export')
  @Permissions(perm(R, ACTIONS.EXPORT))
  @Audit({ action: ACTIONS.EXPORT, resource: R, description: 'Exported customers' })
  async export(@Query() query: CustomerQueryDto, @Res({ passthrough: true }) res: Response) {
    const rows = await this.customers.exportRows(query);
    this.excel.setDownloadHeaders(res, 'customers');
    return new StreamableFile(
      this.excel.jsonToBuffer(rows, {
        sheetName: 'Customers',
        headers: this.customers.exportHeaders(),
      }),
    );
  }

  @Post('import')
  @Permissions(perm(R, ACTIONS.IMPORT))
  @Audit({ action: ACTIONS.IMPORT, resource: R, description: 'Imported customers from Excel' })
  import(@Body() dto: ImportCustomersDto) {
    return this.customers.importRows(dto.rows);
  }

  @Get(':id')
  @Permissions(perm(R, ACTIONS.VIEW))
  get(@Param('id', ParseIntPipe) id: number) {
    return this.customers.findOne(id);
  }

  @Get(':id/rate-list')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateList(@Param('id', ParseIntPipe) id: number) {
    return this.customers.rateList(id);
  }

  @Get(':id/rate-history')
  @Permissions(perm(R, ACTIONS.VIEW))
  rateHistory(@Param('id', ParseIntPipe) id: number) {
    return this.customers.rateHistory(id);
  }

  @Post()
  @Permissions(perm(R, ACTIONS.CREATE))
  @Audit({ action: ACTIONS.CREATE, resource: R })
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  @Permissions(perm(R, ACTIONS.UPDATE))
  @Audit({ action: ACTIONS.UPDATE, resource: R })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @Permissions(perm(R, ACTIONS.DELETE))
  @Audit({ action: ACTIONS.DELETE, resource: R })
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.customers.remove(id);
    return { ok: true };
  }
}
