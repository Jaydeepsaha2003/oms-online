import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChequePhotoRequestsService } from './cheque-photo-requests.service';
import { ChequesController } from './cheques.controller';
import { ChequesService } from './cheques.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ChequesController],
  providers: [ChequesService, ChequePhotoRequestsService],
})
export class ChequesModule {}
