import {
  DEFAULT_MAX_RESPONSE_TOKENS,
  calculateTranslationMaxTokens,
  normalizeMaxTokensMultiplier,
  resolveMaxResponseTokens,
} from './max-tokens.js';

describe('translation max tokens', () => {
  it.each([
    [1, 4096],
    [0.5, 2048],
    [2, 8192],
  ])('calculates 4096 multiplied by %s', (multiplier, expected) => {
    expect(calculateTranslationMaxTokens(4096, multiplier)).toBe(expected);
  });

  it('rounds fractional results to the nearest integer and keeps at least one token', () => {
    expect(calculateTranslationMaxTokens(17, 0.5)).toBe(9);
    expect(calculateTranslationMaxTokens(1, 0.1)).toBe(1);
  });

  it.each([
    [0, 0.1],
    [-1, 0.1],
    [5, 4],
    ['', 1],
    ['invalid', 1],
  ])('normalizes multiplier %p to %s', (value, expected) => {
    expect(normalizeMaxTokensMultiplier(value)).toBe(expected);
  });

  it('accepts a valid configured response length without warning', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();

    expect(resolveMaxResponseTokens('8192', 'openai')).toBe(8192);
    expect(warning).not.toHaveBeenCalled();

    warning.mockRestore();
  });

  it('falls back to 4096 and logs the raw value, API, and fallback', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();

    expect(resolveMaxResponseTokens('invalid', 'textgenerationwebui')).toBe(DEFAULT_MAX_RESPONSE_TOKENS);
    expect(warning).toHaveBeenCalledWith(
      '[Magic Translation] Could not read a valid Max Response Length; using fallback.',
      {
        rawValue: 'invalid',
        mainApi: 'textgenerationwebui',
        fallback: 4096,
      },
    );

    warning.mockRestore();
  });
});
