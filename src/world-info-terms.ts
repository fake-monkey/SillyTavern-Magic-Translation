export interface WorldInfoEntry {
  world?: string;
  comment?: string;
  key?: string[];
  keysecondary?: string[];
  content?: string;
  [key: string]: unknown;
}

const MACRO_PATTERN = /{{[\s\S]*?}}/;
const REGEX_KEY_PATTERN = /^\/[\s\S]+\/[gimsuy]*$/;
const ENGLISH_WORD_PATTERN = /[a-z]+(?:'[a-z]+)?/gi;
const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_]/u;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLiteralTerm(text: string, term: string): string | null {
  const startBoundary = WORD_CHARACTER_PATTERN.test(term[0]) ? '(?<![\\p{L}\\p{N}_])' : '';
  const endBoundary = WORD_CHARACTER_PATTERN.test(term[term.length - 1]) ? '(?![\\p{L}\\p{N}_])' : '';
  const match = text.match(new RegExp(`${startBoundary}${escapeRegex(term)}${endBoundary}`, 'iu'));
  return match?.[0] ?? null;
}

function shouldProtectTerm(term: string, commonWords: ReadonlySet<string>): boolean {
  if (/^\p{Lu}/u.test(term)) {
    return true;
  }

  const words = term.toLowerCase().match(ENGLISH_WORD_PATTERN);
  if (!words?.length) {
    return true;
  }

  return words.some((word) => !commonWords.has(word));
}

/**
 * Finds deterministic, likely in-world terms in the current source text.
 * The entries have already been activated by SillyTavern; this only narrows
 * their keywords to literal terms present in the message being translated.
 */
export function extractProtectedTerms(
  text: string,
  activatedEntries: WorldInfoEntry[],
  commonWords: ReadonlySet<string>,
): string[] {
  const protectedTerms = new Map<string, string>();

  for (const entry of activatedEntries ?? []) {
    for (const rawKey of [...(entry.key ?? []), ...(entry.keysecondary ?? [])]) {
      if (typeof rawKey !== 'string') {
        continue;
      }

      const key = rawKey.trim();
      if (!key || MACRO_PATTERN.test(key) || REGEX_KEY_PATTERN.test(key) || !shouldProtectTerm(key, commonWords)) {
        continue;
      }

      const matchedTerm = findLiteralTerm(text, key);
      if (matchedTerm) {
        protectedTerms.set(matchedTerm.toLocaleLowerCase('en-US'), matchedTerm);
      }
    }
  }

  return Array.from(protectedTerms.values());
}
