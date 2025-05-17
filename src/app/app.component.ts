import { Component, OnInit } from '@angular/core';
import { App } from '@capacitor/app';
import { Platform } from '@ionic/angular';
import { Location } from '@angular/common';
import { SettingsService } from './services/settings.service';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(
    private platform: Platform,
    private location: Location,
    private settingsService: SettingsService
  ) {
    this.platform.ready().then(() => {
      // OAuth callback listener (e.g. Spotify)
      App.addListener('appUrlOpen', (data: { url: string }) => {
        if (data.url.startsWith('capacitor://localhost/callback')) {
          const [, query] = data.url.split('?');
          const params = new URLSearchParams(query);
          const code = params.get('code');
          console.log('OAuth code:', code);
        }
      });

      // Android hardware back-button handler
      App.addListener('backButton', () => {
        // go back in the browser/app history
        this.location.back();
      });
    });
  }

  ngOnInit() {
    this.settingsService.initializeTheme();
  }
}
