import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { NodesModule } from './nodes/nodes.module';
import { ProfileModule } from './profile/profile.module';
import { LibraryModule } from './library/library.module';
import { ReaderModule } from './library/reader.module';
import { CalendarModule } from './calendar/calendar.module';
import { TasksModule } from './tasks/tasks.module';
import { HealthRecordsModule } from './health/health-records.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GmailModule } from './gmail/gmail.module';
import { SchedulesModule } from './schedules/schedules.module';
import { SchedulerModule } from './scheduler/scheduler.module';

/**
 * backend-render — the always-on core. Everything except the assistant,
 * which the web/app reach directly on the laptop (backend-local).
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CommonModule,
    NodesModule,
    ProfileModule,
    LibraryModule,
    ReaderModule,
    CalendarModule,
    TasksModule,
    HealthRecordsModule,
    NotificationsModule,
    GmailModule,
    SchedulesModule,
    SchedulerModule,
  ],
})
export class AppModule {}
