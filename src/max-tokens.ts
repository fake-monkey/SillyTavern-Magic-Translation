export const DEFAULT_MAX_RESPONSE_TOKENS = 4096;
export const DEFAULT_MAX_TOKENS_MULTIPLIER = 1;
export const MIN_MAX_TOKENS_MULTIPLIER = 0.1;
export const MAX_MAX_TOKENS_MULTIPLIER = 4;

export function normalizeMaxTokensMultiplier(value: unknown): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MAX_TOKENS_MULTIPLIER;
  }

  return Math.min(MAX_MAX_TOKENS_MULTIPLIER, Math.max(MIN_MAX_TOKENS_MULTIPLIER, parsed));
}

export function resolveMaxResponseTokens(value: unknown, mainApi: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value.trim())
        : Number.NaN;
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn('[Magic Translation] Could not read a valid Max Response Length; using fallback.', {
    rawValue: value,
    mainApi,
    fallback: DEFAULT_MAX_RESPONSE_TOKENS,
  });
  return DEFAULT_MAX_RESPONSE_TOKENS;
}

export function calculateTranslationMaxTokens(baseMaxTokens: number, multiplier: unknown): number {
  return Math.max(1, Math.round(baseMaxTokens * normalizeMaxTokensMultiplier(multiplier)));
}
