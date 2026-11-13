import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { InternalAuthGuard } from '../common/internal-auth.guard';
import { AssistantService } from './assistant.service';
import { env } from '../config/env';

const completeInput = z.object({
  user_id: z.string().uuid(),
  /** Persona fields; the prompt is built HERE so that logic lives once. */
  persona: z
    .object({
      name: z.string().max(60).nullish(),
      tone: z.string().max(400).nullish(),
      style_notes: z.string().max(4000).nullish(),
    })
    .optional(),
  /** Or a prebuilt system prompt (persona wins when both are present). */
  system: z.string().max(20_000).optional(),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000) }))
    .min(1)
    .max(100),
  model: z.string().max(60).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

/**
 * render → laptop only: generation for scheduled briefs and reports.
 * Shared-secret auth; never exposed to browsers.
 */
@Controller('internal/ai')
@UseGuards(InternalAuthGuard)
export class InternalAiController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('complete')
  async complete(@Body() body: unknown) {
    const input = completeInput.parse(body);
    const system = input.persona
      ? this.assistant.systemPrompt({
          name: input.persona.name ?? undefined,
          tone: input.persona.tone ?? undefined,
          style_notes: input.persona.style_notes ?? null,
        })
      : (input.system ?? this.assistant.systemPrompt({}));

    const text = await this.assistant.complete(
      input.model ?? env().ASSISTANT_MODEL,
      input.temperature ?? 1,
      system,
      input.messages,
    );
    return { text };
  }
}
