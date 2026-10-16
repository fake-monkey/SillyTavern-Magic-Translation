import commonWords10 from 'wordlist-english/english-words-10.json';
import commonWords20 from 'wordlist-english/english-words-20.json';
import commonWords35 from 'wordlist-english/english-words-35.json';

export const COMMON_ENGLISH_WORDS: ReadonlySet<string> = new Set(
  [...commonWords10, ...commonWords20, ...commonWords35].map((word) => word.toLowerCase()),
);
