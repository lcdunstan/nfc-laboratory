import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  timeout: 120000,
  retries: 0,
  use: {
    launchOptions: {
      executablePath: '/home/luke/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome',
      args: ['--headless=new'],
    },
  },
  webServer: {
    command: 'cd /home/luke/sdr/nfc-laboratory/src/nfc-app/app-rx-web && npx vite --port 5177',
    port: 5177,
    reuseExistingServer: true,
  },
});
