/**
 * @fileoverview Message Builder for LLM Calls
 *
 * Converts internal AgentState messages to pi-ai Message format.
 * Extracted from AgentRunner for maintainability.
 */

import type { Message as PiAIMessage, TextContent, Tool } from '@mariozechner/pi-ai';
import type { AgentState, IToolRegistry, SkillState } from './types.js';
import type { ISkillProvider } from './skills/types.js';
import type { SubAgentConfig } from './subagent/types.js';
import type { ToolSchema } from './tools/registry.js';

/**
 * Build skill mode guide based on current skill state
 */
function buildSkillGuide(skillState: SkillState | undefined): string | null {
  if (!skillState) return null;

  const isInSubSkill = skillState.current && skillState.stack.length > 0;

  if (isInSubSkill) {
    // Sub-skill mode: teach return_skill
    const parent = skillState.stack[skillState.stack.length - 1].skillName;
    return `=== SKILL MODE: SUB-SKILL ===
You are currently executing as a sub-skill.

Parent skill: ${parent}
Current skill: ${skillState.current}

When you COMPLETE your assigned task, you MUST call the \`return_skill\` tool:
{
  "result": "Your specific answer here (be detailed)",
  "status": "success"
}

⚠️ IMPORTANT: Do not just say "I'm done" — always use return_skill!
=============================`.trim();
  }

  // Top-level mode: teach load_skill
  if (skillState.availableSkills?.length) {
    const skillLines = skillState.availableSkills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');

    return `=== SKILL MODE: TOP-LEVEL ===
You have access to specialized skills. When you need expertise beyond your base knowledge:

Use the \`load_skill\` tool:
{
  "name": "skill-name",
  "task": "Describe what you need done"
}

Available skills:
${skillLines}
=============================`.trim();
  }

  return null;
}

/**
 * Options for buildMessages
 */
export interface BuildMessagesOptions {
  /** System prompt to prepend */
  systemPrompt?: string;
  /** Model identifier for assistant messages */
  model: string;
  /** Skill provider for injecting skill list into system prompt */
  skillProvider?: ISkillProvider;
  /** Sub-agent config map for injecting sub-agent list into system prompt */
  subAgentConfigs?: Map<string, SubAgentConfig>;
}

/**
 * Build messages array for LLM call from current state
 */
export function buildMessages(state: AgentState, opts: BuildMessagesOptions): PiAIMessage[] {
  const messages: PiAIMessage[] = [];
  const now = Date.now();

  // Combine system prompts into a single user message prefix
  // pi-ai doesn't have a 'system' role, so we prepend to first user message
  // or create a user message with instructions
  const systemParts: string[] = [];

  if (opts.systemPrompt) {
    systemParts.push(opts.systemPrompt);
  }

  if (state.config.instructions) {
    systemParts.push(state.config.instructions);
  }

  // Inject current skill instructions (if in sub-skill mode)
  if (state.context.skillState?.loadedInstructions) {
    systemParts.push(state.context.skillState.loadedInstructions);
  }

  // Inject dynamic skill guide based on current mode
  const skillGuide = buildSkillGuide(state.context.skillState);
  if (skillGuide) {
    systemParts.push(skillGuide);
  }

  // Inject top-level skill list only when not in sub-skill mode
  if (opts.skillProvider && !state.context.skillState?.current) {
    const skills = opts.skillProvider.listSkills();
    if (skills.length > 0) {
      const skillLines = skills.map((s) => `- ${s.name}: ${s.description}`);
      systemParts.push(
        `Available skills:\n${skillLines.join('\n')}\nUse the load_skill tool to load detailed instructions when needed.`
      );
    }
  }

  // Inject sub-agent list into system prompt
  if (opts.subAgentConfigs && opts.subAgentConfigs.size > 0) {
    const subAgentLines = Array.from(opts.subAgentConfigs.values()).map(
      (sa) => `- ${sa.name}: ${sa.description}`
    );
    systemParts.push(
      `Available sub-agents:\n${subAgentLines.join('\n')}\nUse the delegate tool to delegate tasks to specialized sub-agents.`
    );
  }

  // Add combined system prompt as first message if exists
  if (systemParts.length > 0) {
    messages.push({
      role: 'user',
      content: `[System Instructions]\n${systemParts.join('\n\n')}`,
      timestamp: now,
    });

    // Add a fake assistant acknowledgment to maintain conversation flow
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'Understood. I will follow these instructions.' }],
      api: 'openai-completions',
      provider: 'openai',
      model: opts.model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: now,
    });
  }

  // Add conversation history (respecting compression boundary)
  const compression = state.context.compression;
  const startIdx = compression ? compression.anchor : 0;

  // If compressed, inject summary as a system-like user message
  if (compression && compression.summary) {
    messages.push({
      role: 'user',
      content: `[Conversation History Summary]\n${compression.summary}`,
      timestamp: now,
    });
    messages.push({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Understood. I have the context from our previous conversation.' },
      ],
      api: 'openai-completions',
      provider: 'openai',
      model: opts.model,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: now,
    });
  }

  for (let i = startIdx; i < state.context.messages.length; i++) {
    const msg = state.context.messages[i];
    switch (msg.role) {
      case 'user':
        messages.push({
          role: 'user',
          content: msg.content,
          timestamp: now,
        });
        break;

      case 'assistant': {
        // Only include visible messages in LLM context
        if (msg.visible !== false) {
          const content: TextContent[] = [{ type: 'text', text: msg.content }];
          messages.push({
            role: 'assistant',
            content,
            api: 'openai-completions',
            provider: 'openai',
            model: opts.model,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: now,
          });
        }
        break;
      }

      case 'tool':
        // Tool results use 'toolResult' role in pi-ai
        messages.push({
          role: 'toolResult',
          toolCallId: msg.toolCallId ?? 'unknown',
          toolName: 'unknown',
          content: [{ type: 'text', text: msg.content }],
          isError: false,
          timestamp: now,
        });
        break;
    }
  }

  return messages;
}

/**
 * Convert ToolRegistry schemas to pi-ai Tool format
 */
export function getToolsForLLM(registry?: IToolRegistry): Tool[] | undefined {
  if (!registry) return undefined;

  const schemas = registry.toToolSchemas();
  return schemas.map((schema: ToolSchema) => ({
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters as unknown as Tool['parameters'],
  }));
}
