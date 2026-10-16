import { extractProtectedTerms, type WorldInfoEntry } from './world-info-terms.js';
import { COMMON_ENGLISH_WORDS } from './common-words.js';

const commonWords = new Set(['ability', 'forest', 'glade', 'haven', 'magic', 'refuge', 'safe']);

function entries(...keys: string[]): WorldInfoEntry[] {
  return [{ key: keys, keysecondary: [] }];
}

describe('extractProtectedTerms', () => {
  it('only includes keywords that occur in the source text', () => {
    expect(extractProtectedTerms('Eldoria is quiet.', entries('eldoria', 'shadowfang'), commonWords)).toEqual([
      'Eldoria',
    ]);
  });

  it('keeps configured uppercase terms even if they are dictionary words', () => {
    expect(extractProtectedTerms('Magic filled the air.', entries('Magic'), commonWords)).toEqual(['Magic']);
  });

  it('keeps lowercase invented words and preserves source casing', () => {
    expect(extractProtectedTerms('The Shadowfang waited.', entries('shadowfang'), commonWords)).toEqual(['Shadowfang']);
  });

  it('filters lowercase common words and common phrases', () => {
    expect(
      extractProtectedTerms(
        'The forest held magic, a glade, a safe haven, and a refuge.',
        entries('forest', 'magic', 'glade', 'safe haven', 'refuge'),
        commonWords,
      ),
    ).toEqual([]);
  });

  it('keeps a lowercase phrase containing an invented word', () => {
    expect(
      extractProtectedTerms('A shadowfang refuge stood nearby.', entries('shadowfang refuge'), commonWords),
    ).toEqual(['shadowfang refuge']);
  });

  it('skips regex and macro keywords', () => {
    expect(
      extractProtectedTerms('Shadowfang and Eldoria', entries('/Shadow.*/i', '{{user}}', 'eldoria'), commonWords),
    ).toEqual(['Eldoria']);
  });

  it('matches whole terms and de-duplicates them case-insensitively', () => {
    const worldInfo = [{ key: ['eldoria', 'Eldoria'], keysecondary: ['eldoria'] }];

    expect(extractProtectedTerms('Eldorian travelers left Eldoria.', worldInfo, commonWords)).toEqual(['Eldoria']);
  });

  it('keeps only Shadowfang in the Eldoria acceptance example', () => {
    const eldoriaKeys = [
      'eldoria',
      'wood',
      'forest',
      'magical forest',
      'shadowfang',
      'beast',
      'monster',
      'monsters',
      'beasts',
      'glade',
      'safe haven',
      'refuge',
      'power',
      'magic',
      'ability',
    ];

    expect(
      extractProtectedTerms(
        'The forest glade belongs to Shadowfang, whose magic is growing.',
        entries(...eldoriaKeys),
        COMMON_ENGLISH_WORDS,
      ),
    ).toEqual(['Shadowfang']);
  });
});
