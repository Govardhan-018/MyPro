import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { NodeStatusService } from './node-status.service';
import { AgentClient } from './agent-client.service';

/** Lets the web/app grey out the assistant when the laptop is asleep. */
@Controller('nodes')
@UseGuards(AuthGuard)
export class NodesController {
  constructor(private readonly nodes: NodeStatusService) {}

  @Get('status')
  async status() {
    return { agent: await this.nodes.agent() };
  }
}

@Module({
  controllers: [NodesController],
  providers: [NodeStatusService, AgentClient],
  exports: [NodeStatusService, AgentClient],
})
export class NodesModule {}
