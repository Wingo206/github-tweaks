import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    restoreMocks: true,
    projects: [
      {
        test: {
          name: 'extension',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          setupFiles: ['tests/setup.ts'],
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'companion',
          environment: 'node',
          include: ['companion/**/*.test.ts'],
          restoreMocks: true,
        },
      },
    ],
  },
});
