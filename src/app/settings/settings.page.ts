// src/app/settings/settings.page.ts

import { Component, OnInit, OnDestroy } from '@angular/core';
import { SettingsService } from '../services/settings.service';
import { ToastController } from '@ionic/angular';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false
})
export class SettingsPage implements OnInit, OnDestroy {
  // Settings properties
  isDarkMode = false;
  streamingQuality = 'High';
  downloadQuality = 'High';
  cacheSize = '0 MB';

  // Subscription to cleanup on destroy
  private settingsSubscription!: Subscription;

  constructor(
    private settingsService: SettingsService,
    private toast: ToastController
  ) {}

  async ngOnInit() {
    // Subscribe to settings changes
    this.settingsSubscription = this.settingsService.settings$.subscribe(settings => {
      this.isDarkMode = settings.darkMode;
      this.streamingQuality = settings.streamingQuality;
      this.downloadQuality = settings.downloadQuality;
    });

    // Calculate cache size on init
    this.calculateCacheSize();
  }

  ngOnDestroy() {
    // Clean up subscription to prevent memory leaks
    if (this.settingsSubscription) {
      this.settingsSubscription.unsubscribe();
    }
  }

  /**
   * Handle theme toggle in UI
   */
  async toggleTheme(event: any) {
    const isDarkMode = event.detail.checked;
    await this.settingsService.setDarkMode(isDarkMode);
  }

  /**
   * Handle streaming quality change
   */
  async onSetStreaming(quality: string) {
    await this.settingsService.setStreamingQuality(quality);
    this.showToast('Streaming quality updated');
  }

  /**
   * Handle download quality change
   */
  async onSetDownload(quality: string) {
    await this.settingsService.setDownloadQuality(quality);
    this.showToast('Download quality updated');
  }

  /**
   * Clear app cache
   */
  async clearCache() {
    // Add actual cache clearing logic here if available
    this.cacheSize = '0 MB';
    this.showToast('Cache cleared');
  }

  /**
   * Calculate current cache size
   */
  private calculateCacheSize() {
    // Replace with real calculation if available
    this.cacheSize = '45 MB';
  }

  /**
   * Show toast message
   */
  private async showToast(msg: string) {
    const toast = await this.toast.create({
      message: msg,
      duration: 2000,
      position: 'bottom',
      color: 'primary'
    });
    await toast.present();
  }
}
