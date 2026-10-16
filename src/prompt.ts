import * as Handlebars from 'handlebars';

export type TranslationTargetSide = 'internal' | 'display';

interface TranslationChatMessage {
  mes: string;
  extra?: {
    display_text?: unknown;
  };
}

export const DEFAULT_PROMPT = `# Task: Translate Text

You are translating the newest message in an ongoing conversation into {{language}}. Keep the translation natural and consistent with the conversation.

## Reference: Previous Translations
The following are target-language versions of earlier messages in the same conversation. Use them only as light context for names, tone, relationships, and continuity.

{{#each (slice chat -3)}}
**Message {{add @index 1}}:**
> {{this.name}}: {{this.targetText}}

{{/each}}

## Perspective
{{name}}

{{#if protectedTerms}}
## Terms to Keep Untranslated
The following terms occur verbatim in the text and are established in-world terminology. Preserve every listed term exactly as written: do not translate it, transliterate it, change its spelling or capitalization, or add a parenthetical explanation.

{{#each protectedTerms}}
- {{this}}
{{/each}}
{{/if}}

## Text to Translate
\`\`\`
{{prompt}}
\`\`\`

## Instructions
1.  Translate the "Text to Translate" into **{{language}}**.
2.  This is a straightforward translation task. Translate directly and efficiently — there is no need to over-deliberate or second-guess individual word choices.
3.  Preserve every term in "Terms to Keep Untranslated" exactly as written. Do not translate, transliterate, respell, recapitalize, or annotate those terms.
4.  Your response **must** only contain the translated text, enclosed in a single markdown code block. Use plain \`\`\` fences with no language tag (do not write \`\`\`markdown).`;

/**
 * Adds the text that best matches the current translation target to each
 * history entry without changing the stored SillyTavern message fields.
 */
export function addTargetText<T extends TranslationChatMessage>(
  messages: T[],
  targetSide: TranslationTargetSide,
): Array<T & { targetText: string }> {
  return messages.map((message) => {
    const displayText = message.extra?.display_text;
    const targetText = targetSide === 'display' && typeof displayText === 'string' ? displayText : message.mes;
    return { ...message, targetText };
  });
}

if (!Handlebars.helpers['slice']) {
  Handlebars.registerHelper('slice', function (context, count) {
    if (!Array.isArray(context)) return [];
    return context.slice(count);
  });
}

if (!Handlebars.helpers['add']) {
  Handlebars.registerHelper('add', function (value1, value2) {
    return value1 + value2;
  });
}

const HANDLEBARS_CONTROL_PREFIXES = ['#', '/', '!', '>', '{', '&'];

function protectExternalMacros(
  content: string,
  params: Record<string, any>,
): { content: string; restore: (content: string) => string } {
  const protectedMacros: string[] = [];
  const protectedContent = content.replace(/{{\s*([^{}\n]+?)\s*}}/g, (match, expression: string) => {
    const trimmedExpression = expression.trim();
    const firstToken = trimmedExpression.split(/\s+/)[0];

    if (
      !firstToken ||
      HANDLEBARS_CONTROL_PREFIXES.some((prefix) => firstToken.startsWith(prefix)) ||
      firstToken.startsWith('@') ||
      firstToken === 'this' ||
      firstToken === '.' ||
      firstToken.startsWith('this.') ||
      firstToken.startsWith('./') ||
      firstToken in params ||
      Handlebars.helpers[firstToken]
    ) {
      return match;
    }

    const placeholder = `__MAGIC_TRANSLATION_EXTERNAL_MACRO_${protectedMacros.length}__`;
    protectedMacros.push(match);
    return placeholder;
  });

  return {
    content: protectedContent,
    restore: (renderedContent: string) =>
      protectedMacros.reduce(
        (result, macro, index) => result.replace(`__MAGIC_TRANSLATION_EXTERNAL_MACRO_${index}__`, macro),
        renderedContent,
      ),
  };
}

export function renderPromptTemplate(
  content: string,
  params: Record<string, any>,
  substituteParams: (content: string) => string,
): string {
  const protectedTemplate = protectExternalMacros(content, params);
  const template = Handlebars.compile(protectedTemplate.content, { noEscape: true });
  return substituteParams(protectedTemplate.restore(template(params)));
}
