import { Module } from '@nestjs/common';
import { NodesModule } from '../nodes/nodes.module';
import { SchedulerService } from './scheduler.service';

/** render owns the clock — it is the half that is always on. */
@Module({
  imports: [NodesModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
