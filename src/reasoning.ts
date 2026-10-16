export type TranslationReasoningEffort = 'auto' | 'min' | 'low' | 'medium' | 'high' | 'max';

const DEEPSEEK_REASONING_EFFORT: Record<Exclude<TranslationReasoningEffort, 'auto'>, string> = {
  min: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  max: 'max',
};

export function buildReasoningOverride(
  requestReasoning: boolean,
  reasoningEffort: TranslationReasoningEffort,
  isDeepSeek: boolean,
): Record<string, unknown> {
  if (!requestReasoning) {
    return { include_reasoning: false };
  }

  if (reasoningEffort === 'auto') {
    return { include_reasoning: true };
  }

  return {
    include_reasoning: true,
    reasoning_effort: isDeepSeek ? DEEPSEEK_REASONING_EFFORT[reasoningEffort] : reasoningEffort,
  };
}
