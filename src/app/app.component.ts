import { Component } from '@angular/core';
import { App } from '@capacitor/app';
import { Platform } from '@ionic/angular';
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false
})
export class AppComponent {
  constructor(private platform: Platform) {
    this.platform.ready().then(() => {
      App.addListener('appUrlOpen', (data: { url: string }) => {
        // e.g. data.url === 'capacitor://localhost/callback?code=…'
        if (data.url.startsWith('capacitor://localhost/callback')) {
          // parse out the code
          const [, queryString] = data.url.split('?');
          const params = new URLSearchParams(queryString);
          const code = params.get('code');
          // now exchange code for a token…
          console.log('OAuth code:', code);
        }
      });
    });
  }
}
