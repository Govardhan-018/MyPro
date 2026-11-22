import { Injectable, Logger } from '@nestjs/common';
import { SkillsService, type ToolDefinition } from '../skills/skills.service';
import { SKILLS } from '../skills/definitions';
import type { AuthUser } from '../common/auth.guard';
import { CAPABILITY_META } from './capability.meta';
import type { Capability, CapabilityMeta } from './capability.types';
import { selectCapabilities, type Selection, type SelectionOptions } from './capability.routing';

/**
 * The capability registry: the executable skill registry, joined to its
 * routing metadata, filtered to what this user may use.
 *
 * It owns no skills of its own and re-implements no grant logic — eligibility
 * still comes from `SkillsService.toolsFor`, so the health gate has exactly
 * one implementation. What this adds is the ability to answer "which of these
 * does this request need?" without a model call.
 */

/** A skill with no metadata entry still routes, just weakly. */
function derive(name: string): CapabilityMeta {
  return {
    name,
    version: '0.0.0',
    category: 'other',
    keywords: name.split('_').filter((w) => w.length > 3),
    enabled: true,
  };
}

@Injectable()
export class CapabilityRegistry {
  private readonly logger = new Logger(CapabilityRegistry.name);
  private readonly tiers = new Map(SKILLS.map((s) => [s.name, s]));

  constructor(private readonly skills: SkillsService) {
    const missing = SKILLS.filter((s) => !CAPABILITY_META[s.name]).map((s) => s.name);
    if (missing.length) {
      this.logger.warn(
        `no capability metadata for: ${missing.join(', ')} — routed on name alone. ` +
          `Add them to capabilities/capability.meta.ts.`,
      );
    }
  }

  /** Every capability this user may use right now, metadata joined. */
  async forUser(user: AuthUser): Promise<Capability[]> {
    const eligible = await this.skills.toolsFor(user);
    return eligible.map((tool) => this.join(tool));
  }

  /** The whole registry, grants ignored. For documentation and readouts. */
  all(): Capability[] {
    return SKILLS.map((skill) =>
      this.join({
        name: skill.name,
        description: skill.description,
        input_schema: {},
      }),
    );
  }

  /**
   * Narrow a capability list to a request. Pure logic lives in
   * `capability.routing.ts`; this is the injectable door to it.
   */
  select(text: string, capabilities: Capability[], options: SelectionOptions): Selection {
    return selectCapabilities(text, capabilities, options);
  }

  /** The tool payload for the model: only the named capabilities. */
  toolsFor(capabilities: Capability[], names: readonly string[]): ToolDefinition[] {
    const wanted = new Set(names);
    return capabilities
      .filter((c) => wanted.has(c.name))
      .map((c) => ({
        name: c.name,
        description: c.description,
        input_schema: c.input_schema,
      }));
  }

  private join(tool: ToolDefinition): Capability {
    const meta = CAPABILITY_META[tool.name] ?? derive(tool.name);
    const skill = this.tiers.get(tool.name);
    return {
      ...meta,
      description: tool.description,
      permission: skill?.sideEffect ?? 'read',
      requiresGrant: skill?.requiresGrant,
      input_schema: tool.input_schema,
    };
  }
}
