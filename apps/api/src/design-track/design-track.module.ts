import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { ExcelModule } from '../excel/excel.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { DesignTrackController } from './design-track.controller';
import { DesignTrackService } from './design-track.service';

@Module({
  // DispatchModule → the shared pending-line pool; SettingsModule → which design
  // types are tracked; ExcelModule → the Excel export.
  imports: [DispatchModule, SettingsModule, ExcelModule, NotificationsModule],
  controllers: [DesignTrackController],
  providers: [DesignTrackService],
})
export class DesignTrackModule {}
