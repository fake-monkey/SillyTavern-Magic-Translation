import { renderPromptTemplate } from './prompt.js';

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

  it('keeps chat helper rendering available for the default prompt', () => {
    const rendered = renderPromptTemplate(
      '{{#each (slice chat -2)}}{{add @index 1}}. {{this.mes}}\n{{/each}}',
      {
        chat: [{ mes: 'first' }, { mes: 'second' }, { mes: 'third' }],
      },
      (content) => content,
    );

    expect(rendered).toBe('1. second\n2. third\n');
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

  it('renders every activated World Info entry with its full content', () => {
    const rendered = renderPromptTemplate(
      '{{#each worldInfo}}[{{this.world}}/{{this.comment}}]\n{{this.content}}\n{{/each}}',
      {
        worldInfo: [
          { world: 'Eldoria', comment: 'Star Key', content: 'The Star Key opens the Moonlit Archive.' },
          { world: 'Eldoria', comment: 'Alice', content: 'Alice guards the archive at night.' },
        ],
      },
      (content) => content,
    );

    expect(rendered).toContain('[Eldoria/Star Key]\nThe Star Key opens the Moonlit Archive.');
    expect(rendered).toContain('[Eldoria/Alice]\nAlice guards the archive at night.');
  });
});
