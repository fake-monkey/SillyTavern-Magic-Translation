import { buildReasoningOverride } from './reasoning.js';

describe('buildReasoningOverride', () => {
  it('disables reasoning when model reasoning is not requested', () => {
    expect(buildReasoningOverride(false, 'max', true)).toEqual({ include_reasoning: false });
  });

  it('enables reasoning without overriding the profile effort in auto mode', () => {
    expect(buildReasoningOverride(true, 'auto', true)).toEqual({ include_reasoning: true });
  });

  it.each([
    ['min', 'low'],
    ['low', 'low'],
    ['medium', 'high'],
    ['high', 'high'],
    ['max', 'max'],
  ] as const)('maps DeepSeek effort %s to %s', (selectedEffort, expectedEffort) => {
    expect(buildReasoningOverride(true, selectedEffort, true)).toEqual({
      include_reasoning: true,
      reasoning_effort: expectedEffort,
    });
  });

  it('leaves non-DeepSeek effort names unchanged', () => {
    expect(buildReasoningOverride(true, 'medium', false)).toEqual({
      include_reasoning: true,
      reasoning_effort: 'medium',
    });
  });
});
