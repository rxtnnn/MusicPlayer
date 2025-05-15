// capacitor.config.ts

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.soundwave.app',      // match your Android package name
  appName: 'Soundwave',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    cleartext: true,
  }
};

export default config;
