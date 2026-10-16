import { addTargetText, DEFAULT_PROMPT, renderPromptTemplate } from './prompt.js';

describe('renderPromptTemplate', () => {
  it('renders prompt text containing handlebars syntax as data', () => {
    const rendered = renderPromptTemplate(
      'Translate to {{language}}:\n{{prompt}}',
      {
        language: 'English',
        prompt: 'Keep this literal: {{#if broken}}',
      },
      (content) => content,
    );

    expect(rendered).toContain('Translate to English:');
    expect(rendered).toContain('Keep this literal: {{#if broken}}');
  });

  it('keeps the last three chat entries in chronological order', () => {
    const rendered = renderPromptTemplate(
      '{{#each (slice chat -3)}}{{add @index 1}}. {{this.targetText}}\n{{/each}}',
      {
        chat: [{ targetText: 'first' }, { targetText: 'second' }, { targetText: 'third' }, { targetText: 'fourth' }],
      },
      (content) => content,
    );

    expect(rendered).toBe('1. second\n2. third\n3. fourth\n');
  });

  it('uses display text for display-target history and falls back to mes', () => {
    const chat = addTargetText(
      [{ mes: 'internal first', extra: { display_text: 'display first' } }, { mes: 'internal second' }],
      'display',
    );

    expect(chat.map((message) => message.targetText)).toEqual(['display first', 'internal second']);
    expect(chat.map((message) => message.mes)).toEqual(['internal first', 'internal second']);
  });

  it('uses mes for internal-target history', () => {
    const chat = addTargetText([{ mes: 'internal text', extra: { display_text: 'display text' } }], 'internal');

    expect(chat[0].targetText).toBe('internal text');
  });

  it('does not pass extension handlebars blocks to SillyTavern substitutions', () => {
    const rendered = renderPromptTemplate(
      '{{#each (slice chat -1)}}{{this.mes}}{{/each}}\n{{stMacro}}',
      {
        chat: [{ mes: 'translated context' }],
      },
      (content) => {
        expect(content).not.toContain('{{#each');
        return content.replace('{{stMacro}}', 'substituted');
      },
    );

    expect(rendered).toBe('translated context\nsubstituted');
  });

  it('renders extracted World Info keywords as a preserve list', () => {
    const rendered = renderPromptTemplate(
      '{{#each worldInfoKeywords}}- {{this}}\n{{/each}}',
      {
        worldInfoKeywords: ['Star Key', 'Alice'],
      },
      (content) => content,
    );

    expect(rendered).toBe('- Star Key\n- Alice\n');
  });

  it('renders the real default prompt with target language, target-side history, text, and World Info terms', () => {
    const rendered = renderPromptTemplate(
      DEFAULT_PROMPT,
      {
        language: 'Simplified Chinese',
        prompt: 'The Star Key opened the gate.',
        name: 'Alice',
        chat: [{ name: 'Alice', targetText: '她找到了星之钥。' }],
        worldInfoKeywords: ['Star Key'],
      },
      (content) => content,
    );

    expect(rendered).toContain('Translate the "Text to Translate" into **Simplified Chinese**.');
    expect(rendered).toContain('> Alice: 她找到了星之钥。');
    expect(rendered).toContain('The Star Key opened the gate.');
    expect(rendered).toContain('- Star Key');
  });
});
