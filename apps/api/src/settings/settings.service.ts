import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { type OrderOptionDto } from '@oms/shared';
import { PrismaService } from '../prisma/prisma.service';
import { uc } from '../common/coerce';
import { CreateOrderOptionDto } from './dto/order-option.dto';

type Row = Prisma.OrderOptionGetPayload<object>;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<OrderOptionDto[]> {
    const rows = await this.prisma.orderOption.findMany({
      orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(dto: CreateOrderOptionDto): Promise<OrderOptionDto> {
    const group = uc(dto.group)!;
    const value = uc(dto.value)!;
    const max = await this.prisma.orderOption.aggregate({ where: { group }, _max: { sortOrder: true } });
    try {
      const row = await this.prisma.orderOption.create({
        data: { group, value, sortOrder: (max._max.sortOrder ?? -1) + 1 },
      });
      return this.toDto(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('That option already exists.');
      }
      throw err;
    }
  }

  async remove(id: number): Promise<void> {
    const count = await this.prisma.orderOption.count({ where: { id } });
    if (!count) throw new NotFoundException('Option not found.');
    await this.prisma.orderOption.delete({ where: { id } });
  }

  private toDto(r: Row): OrderOptionDto {
    return { id: r.id, group: r.group, value: r.value, sortOrder: r.sortOrder };
  }
}
