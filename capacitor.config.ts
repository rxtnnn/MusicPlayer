import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'io.ionic.starter',
  appName: 'MusicPlayer',
  webDir: 'www',
  server: {
    // This makes Capacitor respond to com.soundwave:// URLs
    androidScheme: 'com.soundwave',
    iosScheme: 'com.soundwave'
  }
};

export default config;
