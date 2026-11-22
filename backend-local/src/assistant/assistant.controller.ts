import { Body, Controller, Get, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthUser } from '../common/auth.guard';
import {
  AssistantService,
  clearInput,
  personaInput,
  sendMessageInput,
  settingsInput,
} from './assistant.service';

/**
 * The whole assistant lives here on the laptop: the continuous chat
 * (with the context-window setting), clear/archive, runtime settings,
 * and the persona/charter. The web/app call this node directly.
 */
@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Get('conversation')
  conversation(@CurrentUser() user: AuthUser) {
    return this.assistant.primaryConversation(user);
  }

  @Get('messages')
  messages(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 50;
    return this.assistant.messages(user, Number.isFinite(n) ? n : 50);
  }

  @Post('messages')
  send(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { content, mode } = sendMessageInput.parse(body);
    return this.assistant.send(user, content, mode);
  }

  /**
   * What the agent can do and how hard it is currently allowed to think.
   * The executable registry is the source of truth; this is its readout, so
   * the UI can never drift from what the agent actually has.
   */
  @Get('capabilities')
  capabilities(@CurrentUser() user: AuthUser) {
    return this.assistant.capabilityReadout(user);
  }

  /** Recent plans with their verified outcome — "did it actually do it?". */
  @Get('plans')
  plans(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number.parseInt(limit, 10) : 10;
    return this.assistant.recentPlans(user, Number.isFinite(n) ? n : 10);
  }

  @Post('clear')
  clear(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { mode } = clearInput.parse(body ?? {});
    return this.assistant.clear(user, mode);
  }

  @Get('settings')
  settings(@CurrentUser() user: AuthUser) {
    return this.assistant.settings(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.assistant.updateSettings(user, settingsInput.parse(body));
  }

  @Get('persona')
  persona(@CurrentUser() user: AuthUser) {
    return this.assistant.persona(user);
  }

  @Patch('persona')
  updatePersona(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.assistant.updatePersona(user, personaInput.parse(body));
  }
}
