const sendRequest = jest.fn();

jest.mock('./config.js', () => ({
  context: {
    extensionSettings: {
      connectionManager: {
        profiles: [{ id: 'profile-1', api: 'deepseek', preset: 'Default' }],
      },
    },
    ConnectionManagerRequestService: {
      sendRequest,
    },
  },
}));

jest.mock('sillytavern-utils-lib/config', () => ({
  st_echo: jest.fn(),
}));

import { sendGenerateRequest } from './generate.js';

describe('sendGenerateRequest', () => {
  beforeEach(() => {
    sendRequest.mockReset();
    sendRequest.mockResolvedValue({ content: 'translated' });
  });

  it('passes the calculated max token limit to the Connection Manager request', async () => {
    await expect(sendGenerateRequest('profile-1', 'Translate me', 2048, { temperature: 0.3 })).resolves.toBe(
      'translated',
    );

    expect(sendRequest).toHaveBeenCalledWith(
      'profile-1',
      [{ content: 'Translate me', role: 'user' }],
      2048,
      undefined,
      { temperature: 0.3 },
    );
  });
});
