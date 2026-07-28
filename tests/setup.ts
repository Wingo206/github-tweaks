import { beforeEach, vi } from 'vitest';

const storage = new Map<string, unknown>();

const browserMock = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: storage.get(key) })),
      set: vi.fn(async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) {
          storage.set(key, value);
        }
      }),
      remove: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  },
  action: {
    openPopup: vi.fn(),
  },
};

vi.stubGlobal('browser', browserMock);

beforeEach(() => {
  storage.clear();
  vi.clearAllMocks();
  document.body.innerHTML = '';
});
