import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'GitHub Tweaks',
    description: 'Personal interface improvements for GitHub.',
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'https://api.github.com/*',
      'https://viewscreen.githubusercontent.com/*',
    ],
    action: {
      default_title: 'GitHub Tweaks',
    },
  },
});
