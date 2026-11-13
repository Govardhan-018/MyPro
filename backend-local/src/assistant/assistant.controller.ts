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
    const { content } = sendMessageInput.parse(body);
    return this.assistant.send(user, content);
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
