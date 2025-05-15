// src/app/services/settings.service.ts

import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Preferences } from '@capacitor/preferences';

/** Shape of your app's settings */
export interface AppSettings {
  darkMode: boolean;
  streamingQuality: string;
  downloadQuality: string;
}

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  private readonly STORAGE_KEY = 'app_settings';
  private readonly THEME_KEY = 'theme'; // For backwards compatibility

  /** Default settings */
  private defaultSettings: AppSettings = {
    darkMode: false,
    streamingQuality: 'High',
    downloadQuality: 'High',
  };

  /** Internal subject holding the current settings */
  private settingsSubject = new BehaviorSubject<AppSettings>(this.defaultSettings);

  /** Public observable for anyone to subscribe */
  public settings$: Observable<AppSettings> = this.settingsSubject.asObservable();

  constructor() {
    this.loadSettings();
  }

  /** Load saved settings (if any) from Preferences, else use defaults */
  private async loadSettings(): Promise<void> {
    try {
      // First try to get theme from the separate theme key (for backwards compatibility)
      const themeResult = await Preferences.get({ key: this.THEME_KEY });

      // Then get the full settings object
      const settingsResult = await Preferences.get({ key: this.STORAGE_KEY });

      let currentSettings = { ...this.defaultSettings };

      // Apply settings if they exist
      if (settingsResult && settingsResult.value) {
        try {
          const savedSettings = JSON.parse(settingsResult.value);
          currentSettings = { ...currentSettings, ...savedSettings };
        } catch (e) {
          console.error('Error parsing saved settings:', e);
        }
      }

      // Override with the theme setting if it exists (priority for backwards compatibility)
      if (themeResult && themeResult.value) {
        currentSettings.darkMode = themeResult.value === 'dark';
      }

      // Update the settings subject
      this.settingsSubject.next(currentSettings);

      // Apply the theme to the document
      this.applyTheme(currentSettings.darkMode);
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  /** Get current settings snapshot */
  get currentSettings(): AppSettings {
    return this.settingsSubject.value;
  }

  /** Set dark mode */
  async setDarkMode(isDarkMode: boolean): Promise<void> {
    // Update dark mode in settings
    const updatedSettings = {
      ...this.currentSettings,
      darkMode: isDarkMode
    };

    try {
      // Apply the theme to the document
      this.applyTheme(isDarkMode);

      // Save theme separately (for backwards compatibility)
      await Preferences.set({
        key: this.THEME_KEY,
        value: isDarkMode ? 'dark' : 'light'
      });

      // Update the settings subject
      this.settingsSubject.next(updatedSettings);

      // Save all settings to storage
      await this.updateSettings(updatedSettings);
    } catch (error) {
      console.error('Error setting dark mode:', error);
    }
  }

  /** Apply theme to document */
  private applyTheme(isDarkMode: boolean): void {
    // Set the color-theme attribute for the entire app
    document.body.setAttribute('color-theme', isDarkMode ? 'dark' : 'light');

    // Apply or remove dark mode class for additional control
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
      document.body.classList.remove('light-mode');
    } else {
      document.body.classList.add('light-mode');
      document.body.classList.remove('dark-mode');
    }
  }

  /** Set streaming quality */
  async setStreamingQuality(quality: string): Promise<void> {
    const updatedSettings = {
      ...this.currentSettings,
      streamingQuality: quality
    };
    await this.updateSettings(updatedSettings);
  }

  /** Set download quality */
  async setDownloadQuality(quality: string): Promise<void> {
    const updatedSettings = {
      ...this.currentSettings,
      downloadQuality: quality
    };
    await this.updateSettings(updatedSettings);
  }

  /** Persist and emit new settings */
  private async updateSettings(settings: AppSettings): Promise<void> {
    try {
      // Update subject with new settings
      this.settingsSubject.next(settings);

      // Save to storage
      await Preferences.set({
        key: this.STORAGE_KEY,
        value: JSON.stringify(settings),
      });
    } catch (error) {
      console.error('Error updating settings:', error);
    }
  }

  /** Toggle dark mode */
  async toggleDarkMode(): Promise<void> {
    await this.setDarkMode(!this.currentSettings.darkMode);
  }

  /** Initialize theme on app startup */
  initializeTheme(): void {
    this.applyTheme(this.currentSettings.darkMode);
  }
}
