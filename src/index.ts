import { ExtensionSettingsManager, buildPresetSelect } from 'sillytavern-utils-lib';
import { context, extensionName, st_updateMessageBlock } from './config.js';
import { sendGenerateRequest } from './generate.js';
import { EventNames } from 'sillytavern-utils-lib/types';
import { AutoModeOptions } from 'sillytavern-utils-lib/types/translate';
import { name1, st_echo } from 'sillytavern-utils-lib/config';
import { languageCodes } from './types/types.js';
import {
  addTargetText,
  DEFAULT_PROMPT,
  renderPromptTemplate,
  type TranslationTargetSide,
} from './prompt.js';

interface PromptPreset {
  content: string;
  filterCodeBlock: boolean;
}

interface ExtensionSettings {
  version: string;
  formatVersion: string;
  profile: string;
  targetLanguage: string;
  internalLanguage: string;
  autoMode: AutoModeOptions;
  promptPreset: string;
  promptPresets: Record<string, PromptPreset>;
  /** When true, disables reasoning/thinking for translation requests, independent of the global setting. */
  disableThinking: boolean;
  /** Sampling overrides for translation. null = use the connection profile's preset value. */
  temperature: number | null;
  top_p: number | null;
}

interface WorldInfoEntry {
  world?: string;
  comment?: string;
  key?: string[];
  keysecondary?: string[];
  content?: string;
  [key: string]: unknown;
}

interface TranslateTextOptions {
  targetSide: TranslationTargetSide;
  messageId?: number;
  targetLanguage?: string;
  profileId?: string;
  preset?: string;
  extraParams?: Record<string, any>;
}

const VERSION = '0.1.1';
const FORMAT_VERSION = 'F_1.0';

const defaultSettings: ExtensionSettings = {
  version: VERSION,
  formatVersion: FORMAT_VERSION,
  profile: '',
  targetLanguage: 'zh-CN',
  internalLanguage: 'en',
  autoMode: AutoModeOptions.NONE,
  promptPreset: 'default',
  promptPresets: {
    default: {
      content: DEFAULT_PROMPT,
      filterCodeBlock: true,
    },
  },
  disableThinking: false,
  temperature: null,
  top_p: null,
};

// Keys for extension settings
const EXTENSION_KEY = 'magicTranslation';

// Message IDs that are currently being generated
let generating: number[] = [];

// World Info activated while constructing the current main-model prompt.
// It is consumed by the next rendered character message and never reused.
let pendingWorldInfo: WorldInfoEntry[] = [];

const settingsManager = new ExtensionSettingsManager<ExtensionSettings>(EXTENSION_KEY, defaultSettings);

const incomingTypes = [AutoModeOptions.RESPONSES, AutoModeOptions.BOTH];
const outgoingTypes = [AutoModeOptions.INPUT, AutoModeOptions.BOTH];

/**
 * Collects the trigger keywords (primary + secondary) of the activated World Info
 * entries into a de-duplicated list. Only the keywords are sent to the translation
 * model, not the full entry content, to keep the request small and fast.
 */
function extractKeywords(worldInfo: WorldInfoEntry[]): string[] {
  const keywords = new Set<string>();
  for (const entry of worldInfo ?? []) {
    for (const key of [...(entry.key ?? []), ...(entry.keysecondary ?? [])]) {
      if (typeof key === 'string' && key.trim()) {
        keywords.add(key.trim());
      }
    }
  }
  return Array.from(keywords);
}

async function initUI() {
  if (!context.extensionSettings.connectionManager) {
    st_echo('error', 'Connection Manager is required to use Magic Translation');
    return;
  }

  await initSettings();

  context.eventSource.on('generation_started', (_type: unknown, _params: unknown, isDryRun: boolean) => {
    if (!isDryRun) {
      pendingWorldInfo = [];
    }
  });

  context.eventSource.on('world_info_activated', (entries: WorldInfoEntry[]) => {
    pendingWorldInfo = structuredClone(entries ?? []);
  });

  const showTranslateButton = $(
    `<div title="Magic Translate" class="mes_button mes_magic_translation_button fa-solid fa-globe interactable" tabindex="0"></div>`,
  );
  $('#message_template .mes_buttons .extraMesButtons').prepend(showTranslateButton);

  $(document).on('click', '.mes_magic_translation_button', async function () {
    const messageBlock = $(this).closest('.mes');
    const messageId = Number(messageBlock.attr('mesid'));
    const message = context.chat[messageId];
    if (!message) {
      st_echo('error', `Could not find message with id ${messageId}`);
      return;
    }
    if (message?.extra?.display_text) {
      delete message.extra.display_text;
      st_updateMessageBlock(messageId, message);
      return;
    }
    await generateMessage(messageId, 'incomingMessage');
    const eventData = {
      messageId,
      type: 'incomingMessage',
      auto: false,
    };
    context.eventSource.emit('magic_translation_done', eventData);
    context.eventSource.emit('magic_translation_character_message', eventData);
  });

  const settings = settingsManager.getSettings();
  // Show the display-language text (extra.display_text) in the editor instead of the internal text.
  context.eventSource.on('message_edit_started', (data: { message?: { extra?: { display_text?: string } }; text?: string }) => {
    const message = data?.message;
    if (message && typeof message.extra?.display_text === 'string') {
      data.text = message.extra.display_text;
    }
  });
  // After editing, translate the edited display-language text back to the internal language.
  context.eventSource.on(EventNames.MESSAGE_EDITED, (messageId: number, previous?: { previousText?: string; previousDisplayText?: string }) => {
    translateMessageEdit(messageId, previous);
  });
  // TODO: IMPERSONATE_READY emits generated text, not a numeric message ID. Keep the
  // legacy handler unchanged until the low-use impersonate path is redesigned.
  context.eventSource.on(EventNames.IMPERSONATE_READY, async (messageId: number) => {
    if (outgoingTypes.includes(settings.autoMode)) {
      await generateMessage(messageId, 'impersonate');
      const eventData = {
        messageId,
        type: 'impersonate',
        auto: true,
      };
      context.eventSource.emit('magic_translation_done', eventData);
      context.eventSource.emit('magic_translation_impersonate', eventData);
    }
  });

  // @ts-ignore
  context.eventSource.makeFirst(EventNames.CHARACTER_MESSAGE_RENDERED, async (messageId: number) => {
    const worldInfo = structuredClone(pendingWorldInfo);
    pendingWorldInfo = [];

    if (incomingTypes.includes(settings.autoMode)) {
      await generateMessage(messageId, 'incomingMessage', worldInfo);
      const eventData = {
        messageId,
        type: 'incomingMessage',
        auto: true,
      };
      context.eventSource.emit('magic_translation_done', eventData);
      context.eventSource.emit('magic_translation_character_message', eventData);
    }
  });
  // @ts-ignore
  context.eventSource.makeFirst(EventNames.USER_MESSAGE_RENDERED, async (messageId: number) => {
    if (outgoingTypes.includes(settings.autoMode)) {
      await generateMessage(messageId, 'userInput');
      const eventData = {
        messageId,
        type: 'userInput',
        auto: true,
      };
      context.eventSource.emit('magic_translation_done', eventData);
      context.eventSource.emit('magic_translation_user_message', eventData);
    }
  });

  const extensionsMenu = document.querySelector('#extensionsMenu');
  const magicTranslateWandContainer = document.createElement('div');
  magicTranslateWandContainer.id = 'magic_translate_wand_container';
  magicTranslateWandContainer.className = 'extension_container';
  extensionsMenu?.appendChild(magicTranslateWandContainer);
  const buttonHtml = await context.renderExtensionTemplateAsync(`third-party/${extensionName}`, 'templates/buttons');
  magicTranslateWandContainer.insertAdjacentHTML('beforeend', buttonHtml);
  extensionsMenu?.querySelector('#magic_translate_input')?.addEventListener('click', async () => {
    const sendTextarea = document.querySelector('#send_textarea') as HTMLTextAreaElement;
    if (sendTextarea) {
      const selectionStart = sendTextarea.selectionStart;
      const selectionEnd = sendTextarea.selectionEnd;
      const selectedText = sendTextarea.value.substring(selectionStart, selectionEnd);

      let textToTranslate = sendTextarea.value;
      let isSelection = false;

      if (selectedText) {
        textToTranslate = selectedText;
        isSelection = true;
      }

      const settings = settingsManager.getSettings();
      const translatedText = await translateText(textToTranslate, {
        targetSide: 'internal',
        targetLanguage: settings.internalLanguage,
      });

      if (translatedText) {
        if (isSelection) {
          const fullText = sendTextarea.value;
          sendTextarea.value =
            fullText.substring(0, selectionStart) + translatedText + fullText.substring(selectionEnd);
        } else {
          sendTextarea.value = translatedText;
        }
      }
    }
  });
}

async function initSettings() {
  const settings = settingsManager.getSettings();

  const extendedLanguageCodes = Object.entries(languageCodes).reduce(
    (acc, [name, code]) => {
      // @ts-ignore
      acc[code] = { name: name, selected: code === settings.targetLanguage };
      return acc;
    },
    {} as Record<string, { name: string; selected: boolean }>,
  );

  const settingsHtml = await context.renderExtensionTemplateAsync(
    `third-party/${extensionName}`,
    'templates/settings',
    { languageCodes: extendedLanguageCodes },
  );
  $('#extensions_settings').append(settingsHtml);

  const settingsElement = $('.magic-translation-settings');
  const promptElement = settingsElement.find('.prompt');
  const filterCodeBlockElement = settingsElement.find('.filter_code_block');

  // Use buildPresetSelect for preset management
  buildPresetSelect('.magic-translation-settings select.prompt_preset', {
    initialValue: settings.promptPreset,
    initialList: Object.keys(settings.promptPresets),
    readOnlyValues: ['default'],
    onSelectChange: async (_previousValue, newValue) => {
      const newPresetValue = newValue ?? 'default';
      settings.promptPreset = newPresetValue;
      const preset = settings.promptPresets[newPresetValue];

      promptElement.val(preset.content);
      filterCodeBlockElement.prop('checked', preset.filterCodeBlock);

      settingsManager.saveSettings();
    },
    create: {
      onAfterCreate: (value) => {
        const currentPreset = settings.promptPresets[settings.promptPreset];
        settings.promptPresets[value] = {
          content: currentPreset.content,
          filterCodeBlock: currentPreset.filterCodeBlock,
        };
      },
    },
    rename: {
      onAfterRename: (previousValue, newValue) => {
        settings.promptPresets[newValue] = settings.promptPresets[previousValue];
        delete settings.promptPresets[previousValue];
      },
    },
    delete: {
      onAfterDelete: (value) => {
        delete settings.promptPresets[value];
      },
    },
  });

  // Profile selection
  context.ConnectionManagerRequestService.handleDropdown(
    '.magic-translation-settings .profile',
    settings.profile,
    (profile) => {
      settings.profile = profile?.id ?? '';
      settingsManager.saveSettings();
    },
  );

  const sysSettingsButton = $('#sys-settings-button .drawer-toggle');
  const redirectSysSettings = settingsElement.find('.redirect_sys_settings');
  redirectSysSettings.on('click', function () {
    sysSettingsButton.trigger('click');
  });

  promptElement.val(settings.promptPresets[settings.promptPreset].content);
  promptElement.on('change', function () {
    const template = promptElement.val() as string;
    settings.promptPresets[settings.promptPreset].content = template;
    settingsManager.saveSettings();
  });

  settingsElement.find('.restore_default').on('click', async function () {
    const confirm = await context.Popup.show.confirm('Restore default prompt?', 'Restore Default');
    if (!confirm) return;

    promptElement.val(DEFAULT_PROMPT);
    settings.promptPresets[settings.promptPreset].content = DEFAULT_PROMPT;
    settingsManager.saveSettings();
  });

  filterCodeBlockElement.prop('checked', settings.promptPresets[settings.promptPreset].filterCodeBlock);
  filterCodeBlockElement.on('change', function () {
    const checked = filterCodeBlockElement.prop('checked');
    settings.promptPresets[settings.promptPreset].filterCodeBlock = checked;
    settingsManager.saveSettings();
  });

  const targetLanguageElement = settingsElement.find('.target_language');
  targetLanguageElement.val(settings.targetLanguage);
  targetLanguageElement.on('change', function () {
    const targetLanguage = targetLanguageElement.val() as string;
    settings.targetLanguage = targetLanguage;
    settingsManager.saveSettings();
  });

  const autoModeElement = settingsElement.find('.auto_mode');
  autoModeElement.val(settings.autoMode);
  autoModeElement.on('change', function () {
    const autoMode = autoModeElement.val() as string;
    settings.autoMode = autoMode as AutoModeOptions;
    settingsManager.saveSettings();
  });

  const disableThinkingElement = settingsElement.find('.disable_thinking');
  disableThinkingElement.prop('checked', settings.disableThinking);
  disableThinkingElement.on('change', function () {
    settings.disableThinking = disableThinkingElement.prop('checked');
    settingsManager.saveSettings();
  });

  const temperatureElement = settingsElement.find('.temperature');
  temperatureElement.val(settings.temperature ?? '');
  temperatureElement.on('change', function () {
    settings.temperature = parseSamplingNumber(temperatureElement.val());
    settingsManager.saveSettings();
  });

  const topPElement = settingsElement.find('.top_p');
  topPElement.val(settings.top_p ?? '');
  topPElement.on('change', function () {
    settings.top_p = parseSamplingNumber(topPElement.val());
    settingsManager.saveSettings();
  });
}

/**
 * Parses a sampling-parameter input value into a number, or null when it should
 * be left unset (empty/non-numeric), which means "use the profile preset value".
 */
function parseSamplingNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function translateText(
  text: string,
  { targetSide, messageId, targetLanguage, profileId, preset, extraParams = {} }: TranslateTextOptions,
): Promise<string | null> {
  const settings = settingsManager.getSettings();
  let selectedProfileId = profileId ?? settings.profile;

  if (profileId) {
    const profile = context.extensionSettings.connectionManager?.profiles.find(
      (p: any) => p.id === profileId || p.name === profileId,
    );
    if (profile) {
      selectedProfileId = profile.id;
    }
  }

  if (!selectedProfileId) {
    st_echo('warning', 'Select a connection profile');
    return null;
  }

  const selectedPresetName = preset ?? settings.promptPreset;
  const selectedPreset = settings.promptPresets[selectedPresetName];
  if (!selectedPreset || !selectedPreset.content) {
    st_echo('error', `Prompt preset "${selectedPresetName}" not found.`);
    return null;
  }

  const languageCode = targetLanguage ?? settings.targetLanguage;
  const languageText = Object.entries(languageCodes).find(([, code]) => code === languageCode)?.[0];
  if (!languageText) {
    st_echo('error', `Make sure language ${languageCode} is supported`);
    return null;
  }

  const allExtraParams: Record<string, any> = {
    prompt: text,
    language: languageText,
    chat: addTargetText(structuredClone(context.chat).slice(0, messageId), targetSide),
    name: messageId !== undefined ? context.chat[messageId].name : name1,
    message: messageId !== undefined ? context.chat[messageId] : undefined,
    ...extraParams,
  };

  const renderedPrompt = renderPromptTemplate(selectedPreset.content, allExtraParams, (content) =>
    context.substituteParams(content),
  );

  // Optionally disable reasoning/thinking for translation, independent of the global setting.
  const overridePayload: Record<string, any> =
    settings.disableThinking ? { include_reasoning: false } : {};
  // Optionally override sampling parameters (temperature/top_p) for translation.
  if (typeof settings.temperature === 'number') {
    overridePayload.temperature = settings.temperature;
  }
  if (typeof settings.top_p === 'number') {
    overridePayload.top_p = settings.top_p;
  }

  try {
    const response = await sendGenerateRequest(selectedProfileId, renderedPrompt, overridePayload);
    if (!response) {
      return null;
    }

    let displayText = response;
    if (selectedPreset.filterCodeBlock) {
      const codeBlockMatch = response.match(/^(?:[^`]*?)\n?```[\s\S]*?\n([\s\S]*?)```(?![^`]*```)/);
      if (codeBlockMatch) {
        displayText = codeBlockMatch[1].trim();
      }
    }
    return displayText;
  } catch (error) {
    console.error(error);
    st_echo('error', `Translation failed: ${error}`);
    return null;
  }
}

/**
 * @param messageId If type is 'impersonate', messageId is the message impersonate
 * @param type userInput: User sended message, incomingMessage: Message from LLM, impersonate: Message impersonate
 */
async function generateMessage(
  messageId: number,
  type: 'userInput' | 'incomingMessage' | 'impersonate',
  worldInfo: WorldInfoEntry[] = [],
) {
  const settings = settingsManager.getSettings();
  const profileId = settings.profile;
  if (!profileId) {
    let warningMessage = 'Select a connection profile';

    // Improve warning message
    if (type === 'userInput' && outgoingTypes.includes(settings.autoMode)) {
      warningMessage += '. Or disable auto mode.';
    } else if (type === 'impersonate' && outgoingTypes.includes(settings.autoMode)) {
      warningMessage += '. Or disable auto mode.';
    } else if (type === 'incomingMessage' && incomingTypes.includes(settings.autoMode)) {
      warningMessage += '. Or disable auto mode.';
    }

    st_echo('warning', warningMessage);
    return;
  }

  const message = type !== 'impersonate' ? context.chat[messageId] : undefined;
  if (!message && type !== 'impersonate') {
    st_echo('error', `Could not find message with id ${messageId}`);
    return;
  }
  if (generating.includes(messageId) && message) {
    st_echo('warning', 'Translation is already in progress');
    return;
  }

  const languageCode = type === 'userInput' ? settings.internalLanguage : settings.targetLanguage;

  const extraParams: Record<string, any> = {
    translationType: type,
    worldInfoKeywords: type === 'incomingMessage' ? extractKeywords(worldInfo) : [],
  };

  if (message) {
    // When a message is selected, iterate backwards from the messageId
    for (let i = 0; i <= messageId; i++) {
      const currentMessage = context.chat[messageId - i];
      if (currentMessage) {
        extraParams[`chat_${i + 1}`] = currentMessage.mes;
      }
    }
  } else {
    // Keep original behavior for impersonate mode (no specific message selected)
    for (let i = 0; i < context.chat.length; i++) {
      const chatMessage = context.chat[context.chat.length - 1 - i];
      if (chatMessage) {
        extraParams[`chat_${i + 1}`] = chatMessage.mes;
      }
    }
  }

  if (message) {
    generating.push(messageId);
  }
  try {
    const displayText = await translateText(message?.mes ?? (messageId as unknown as string), {
      targetSide: type === 'userInput' ? 'internal' : 'display',
      messageId,
      targetLanguage: languageCode,
      extraParams,
    });

    if (!displayText) {
      return;
    }

    if (message) {
      if (type === 'userInput') {
        if (typeof message.extra !== 'object' || message.extra === null) {
          message.extra = {};
        }
        message.extra.display_text = message.mes;
        message.mes = displayText;
      } else {
        if (typeof message.extra !== 'object') {
          message.extra = {};
        }
        message.extra.display_text = displayText;
      }
      st_updateMessageBlock(messageId, message);
      await context.saveChat();
    } else {
      $('#send_textarea').val(displayText);
    }
  } catch (error) {
    console.error(error);
    st_echo('error', `Translation failed: ${error}`);
  } finally {
    if (message) {
      generating = generating.filter((id) => id !== messageId);
    }
  }
}

/**
 * Handles a message that was just edited.
 *
 * The editor shows `extra.display_text` (the display language), so after editing,
 * `message.mes` holds the edited display-language text. Translate it back to the
 * internal language and keep the edited text as `extra.display_text`.
 *
 * @param messageId ID of the edited message
 * @param previous Values captured before the edit, used to roll back on failure
 */
async function translateMessageEdit(
  messageId: number,
  previous?: { previousText?: string; previousDisplayText?: string },
) {
  const settings = settingsManager.getSettings();
  const message = context.chat[messageId];
  if (!message) {
    return;
  }

  if (typeof message.extra !== 'object' || message.extra === null) {
    message.extra = {};
  }

  // System messages (or auto mode off with a stale translation) keep no display text.
  if (message.is_system || (settings.autoMode === AutoModeOptions.NONE && message.extra?.display_text)) {
    delete message.extra.display_text;
    st_updateMessageBlock(messageId, message);
    await context.saveChat();
    return;
  }

  const isUser = Boolean(message.is_user);
  const shouldTranslate = isUser
    ? outgoingTypes.includes(settings.autoMode)
    : incomingTypes.includes(settings.autoMode);
  if (!shouldTranslate) {
    return;
  }

  const editedDisplayText = message.mes;
  const translation = await translateText(editedDisplayText, {
    targetSide: 'internal',
    messageId,
    targetLanguage: settings.internalLanguage,
  });
  if (typeof translation === 'string') {
    message.extra.display_text = editedDisplayText;
    message.mes = translation;
  } else {
    message.mes = previous?.previousText ?? message.mes;
    if (previous?.previousDisplayText === undefined) {
      delete message.extra.display_text;
    } else {
      message.extra.display_text = previous.previousDisplayText;
    }
  }

  st_updateMessageBlock(messageId, message);
  await context.saveChat();
}

function main() {
  initUI();

  // Register the magic-translate slash command
  context.SlashCommandParser.addCommandObject(
    context.SlashCommand.fromProps({
      name: 'magic-translate',
      callback: async (args: any, value: String) => {
        // Default to -1 (the latest message) if no value is provided
        const messageId = value ? Number(value.toString()) : -1;
        if (isNaN(messageId)) {
          return 'Invalid message ID. Please provide a valid number or -1 for the latest message.';
        }

        try {
          let actualMessageId = messageId;
          // If messageId is -1, get the latest message ID
          if (messageId === -1) {
            actualMessageId = context.chat.length - 1;
          }

          await generateMessage(actualMessageId, 'incomingMessage');
          return `Message ${messageId === -1 ? 'latest' : messageId} has been translated.`;
        } catch (error) {
          console.error(error);
          return `Failed to translate message ${messageId === -1 ? 'latest' : messageId}: ${error}`;
        }
      },
      returns: 'confirmation of translation',
      unnamedArgumentList: [
        context.SlashCommandArgument.fromProps({
          description: 'the ID of the message to translate (use -1 for latest message)',
          typeList: [context.ARGUMENT_TYPE.NUMBER],
          isRequired: false,
        }),
      ],
      helpString: `
      <div>
        Translates a message with the specified ID using Magic Translation.
        If no ID is provided or ID is -1, the latest message will be translated.
      </div>
      <div>
        <strong>Examples:</strong>
        <ul>
          <li>
            <pre><code class="language-stscript">/magic-translate</code></pre>
            translates the latest message
          </li>
          <li>
            <pre><code class="language-stscript">/magic-translate -1</code></pre>
            also translates the latest message
          </li>
          <li>
            <pre><code class="language-stscript">/magic-translate 5</code></pre>
            translates the message with ID 5
          </li>
        </ul>
      </div>
    `,
    }),
  );

  context.SlashCommandParser.addCommandObject(
    context.SlashCommand.fromProps({
      name: 'magic-translate-text',
      callback: async (args: { target?: string; profile?: string; preset?: string }, value: string) => {
        if (!value) {
          return 'Please provide the text to translate.';
        }

        try {
          const translatedText = await translateText(value, {
            targetSide: 'display',
            targetLanguage: args.target,
            profileId: args.profile,
            preset: args.preset,
          });
          return translatedText ?? 'Translation failed.';
        } catch (error) {
          console.error(error);
          return `Failed to translate text: ${error}`;
        }
      },
      returns: 'translated text',
      unnamedArgumentList: [
        context.SlashCommandArgument.fromProps({
          description: 'the text to translate',
          typeList: [context.ARGUMENT_TYPE.STRING],
          isRequired: true,
        }),
      ],
      namedArgumentList: [
        context.SlashCommandNamedArgument.fromProps({
          name: 'target',
          description: 'the target language code',
          typeList: [context.ARGUMENT_TYPE.STRING],
          enumList: Object.values(languageCodes),
          isRequired: false,
        }),
        context.SlashCommandNamedArgument.fromProps({
          name: 'profile',
          description: 'the connection profile to use',
          typeList: [context.ARGUMENT_TYPE.STRING],
          isRequired: false,
        }),
        context.SlashCommandNamedArgument.fromProps({
          name: 'preset',
          description: 'the prompt preset to use',
          typeList: [context.ARGUMENT_TYPE.STRING],
          isRequired: false,
        }),
      ],
      helpString: `
      <div>
        Translates the given text using Magic Translation.
      </div>
      <div>
        <strong>Example:</strong>
        <ul>
          <li>
            <pre><code class="language-stscript">/magic-translate-text Hello world</code></pre>
            translates "Hello world" to the default target language.
          </li>
          <li>
            <pre><code class="language-stscript">/magic-translate-text target="es" Hello world</code></pre>
            translates "Hello world" to Spanish.
          </li>
          <li>
            <pre><code class="language-stscript">/magic-translate-text profile="My-Profile" Hello world</code></pre>
            translates "Hello world" using the "My-Profile" connection profile.
          </li>
          <li>
            <pre><code class="language-stscript">/magic-translate-text preset="My-Preset" Hello world</code></pre>
            translates "Hello world" using the "My-Preset" prompt preset.
          </li>
        </ul>
      </div>
    `,
    }),
  );
}

function importCheck(): boolean {
  if (!context.ConnectionManagerRequestService) {
    return false;
  }
  return true;
}

if (!importCheck()) {
  st_echo('error', `[${extensionName}] Make sure ST is updated.`);
} else {
  settingsManager
    .initializeSettings()
    .then((result) => {
      const settings = settingsManager.getSettings();
      // Handle migration from old format
      if (result.oldSettings && !result.oldSettings.promptPresets) {
        const oldTemplate = result.oldSettings.template;
        if (oldTemplate && oldTemplate !== DEFAULT_PROMPT) {
          settings.promptPresets.custom = {
            content: oldTemplate,
            filterCodeBlock: result.oldSettings.filterCodeBlock ?? true,
          };
          settings.promptPreset = 'custom';
          settingsManager.saveSettings();
        }
      }

      main();
    })
    .catch((error) => {
      st_echo('error', error);
      context.Popup.show
        .confirm('Data migration failed. Do you want to reset the roadway data?', 'Roadway')
        .then((result: any) => {
          if (result) {
            settingsManager.resetSettings();
            main();
          }
        });
    });
}
