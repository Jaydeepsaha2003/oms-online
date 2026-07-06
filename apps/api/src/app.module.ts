import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { configuration, validateEnv } from './config/configuration';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

import { PrismaModule } from './prisma/prisma.module';
import { ExcelModule } from './excel/excel.module';
import { PdfModule } from './pdf/pdf.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { PermissionsModule } from './permissions/permissions.module';
import { MenuModule } from './menu/menu.module';
import { CustomersModule } from './customers/customers.module';
import { AgentsModule } from './agents/agents.module';
import { TransportersModule } from './transporters/transporters.module';
import { GstRatesModule } from './gst-rates/gst-rates.module';
import { TransRatesModule } from './trans-rates/trans-rates.module';
import { ProductsModule } from './products/products.module';
import { DesignsModule } from './designs/designs.module';
import { DesignNamesModule } from './design-names/design-names.module';
import { CombinationsModule } from './combinations/combinations.module';
import { OrdersModule } from './orders/orders.module';
import { BookingsModule } from './bookings/bookings.module';
import { QuotationsModule } from './quotations/quotations.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { ChallansModule } from './challans/challans.module';
import { SpecialRatesModule } from './special-rates/special-rates.module';
import { CrmModule } from './crm/crm.module';
import { ChequesModule } from './cheques/cheques.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { OpeningBalancesModule } from './opening-balances/opening-balances.module';
import { PaymentsModule } from './payments/payments.module';
import { DiscountsModule } from './discounts/discounts.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AccessImportModule } from './access-import/access-import.module'; // TEMP: MS Access connector
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),

    // Infrastructure (global providers)
    PrismaModule,
    ExcelModule,
    PdfModule,
    AuditModule,

    // Feature modules
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    MenuModule,
    CustomersModule,
    AgentsModule,
    TransportersModule,
    GstRatesModule,
    TransRatesModule,
    ProductsModule,
    DesignsModule,
    DesignNamesModule,
    CombinationsModule,
    OrdersModule,
    BookingsModule,
    QuotationsModule,
    DispatchModule,
    ChallansModule,
    SpecialRatesModule,
    CrmModule,
    ChequesModule,
    BankAccountsModule,
    OpeningBalancesModule,
    PaymentsModule,
    DiscountsModule,
    AnalyticsModule,
    AccessImportModule, // TEMP: MS Access connector — remove this line + the folder to delete

    SettingsModule,
  ],
  controllers: [AppController],
  providers: [
    // Order matters: throttle → authenticate → authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Wrap successful responses; AuditInterceptor is registered inside AuditModule.
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
