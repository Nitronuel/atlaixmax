import { describe, expect, it } from 'vitest';
import { ASSISTANT_TOOLS, OPENROUTER_TOOLS, isAssistantToolName, validateAssistantToolArgs } from './tools';

describe('AI assistant tool registry', () => {
  it('exposes assistant-level tools to the model', () => {
    expect(isAssistantToolName('get_token_profile')).toBe(true);
    expect(isAssistantToolName('/api/overview/feed')).toBe(false);
    expect(OPENROUTER_TOOLS.length).toBe(ASSISTANT_TOOLS.length);
  });

  it('describes tools as OpenRouter function tools', () => {
    const tokenProfile = OPENROUTER_TOOLS.find((tool) => tool.function.name === 'get_token_profile');

    expect(tokenProfile?.type).toBe('function');
    expect(tokenProfile?.function.parameters.type).toBe('object');
    expect(tokenProfile?.function.parameters.additionalProperties).toBe(false);
  });

  it('cleans model tool arguments before backend execution', () => {
    const args = validateAssistantToolArgs({
      address: ` ${'a'.repeat(200)} `,
      chain: ' base ',
      query: ' pepe ',
      severity: 'critical',
      sentiment: 'bearish',
      responseStyle: 'verbose',
      unexpected: 'ignored'
    });

    expect(args.address).toHaveLength(140);
    expect(args.chain).toBe('base');
    expect(args.query).toBe('pepe');
    expect(args.severity).toBe('critical');
    expect(args.sentiment).toBe('bearish');
    expect(args.responseStyle).toBeUndefined();
    expect(args).not.toHaveProperty('unexpected');
  });
});
