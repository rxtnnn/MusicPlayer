import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { RouteReuseStrategy } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { HttpClientModule } from '@angular/common/http';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { MusicPlayerComponent } from './components/music-player/music-player.component';
import { IonicStorageModule } from '@ionic/storage-angular';
import { Filesystem } from '@capacitor/filesystem';

import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { far } from '@fortawesome/free-regular-svg-icons';
import { fab } from '@fortawesome/free-brands-svg-icons';

@NgModule({
  declarations: [AppComponent, MusicPlayerComponent],
  imports: [
    BrowserModule,
    IonicModule.forRoot(),
    AppRoutingModule,
    HttpClientModule, // Import HttpClientModule for HTTP requests
    FontAwesomeModule,
    IonicStorageModule.forRoot({
      name: '__harmony_db',
      driverOrder: ['sqlite', 'indexeddb', 'localstorage']
    })
  ],
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // No need to provide CapacitorSQLite or SQLiteDBConnection here
  ],
  bootstrap: [AppComponent],
})
export class AppModule {
    constructor(library: FaIconLibrary) {
    // Add the icon packs to the library
    library.addIconPacks(fas, far, fab);
  }
}
