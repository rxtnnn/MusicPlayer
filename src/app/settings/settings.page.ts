import { Component, OnInit } from '@angular/core';
import { ThemeService } from '../services/theme.service';
import { StorageService } from '../services/storage.service';
import { ToastController } from '@ionic/angular';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit {
  isDarkMode: any;
  streamingQuality = 'High';
  downloadQuality = 'High';
  cacheSize = '0 MB';

  constructor(
    private themeService: ThemeService,
    private storageService: StorageService,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    this.isDarkMode = await this.themeService.isDarkMode().toPromise();
    this.streamingQuality = await this.storageService.get('streaming_quality') || 'High';
    this.downloadQuality = await this.storageService.get('download_quality') || 'High';
    await this.calculateCacheSize();
  }

  toggleDarkMode() {
    this.isDarkMode = !this.isDarkMode;
    this.themeService.setDarkMode(this.isDarkMode);
  }

  async setStreamingQuality(quality: string) {
    this.streamingQuality = quality;
    await this.storageService.set('streaming_quality', quality);
    this.showToast('Streaming quality updated');
  }

  async setDownloadQuality(quality: string) {
    this.downloadQuality = quality;
    await this.storageService.set('download_quality', quality);
    this.showToast('Download quality updated');
  }

  async calculateCacheSize() {
    // In a real app, this would calculate the actual cache size
    // For demo purposes, we'll just use a placeholder value
    this.cacheSize = '45 MB';
  }

  async clearCache() {
    // In a real app, this would clear the cache
    // For demo purposes, we'll just update the display
    this.cacheSize = '0 MB';
    this.showToast('Cache cleared');
  }

  async showToast(message: string) {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'primary'
    });
    await toast.present();
  }

  openEqualizer() {
    // This would open an equalizer component in a real app
    this.showToast('Equalizer not implemented in this demo');
  }

  signOut() {
    // This would handle sign out in a real app
    this.showToast('Sign out functionality not implemented in this demo');
  }
}
