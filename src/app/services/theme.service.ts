import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { StorageService } from './storage.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private darkMode = new BehaviorSubject<boolean>(false);

  constructor(private storageService: StorageService) {}

  async initTheme() {
    const isDarkMode = await this.storageService.get('dark_mode');
    const prefersColor = window.matchMedia('(prefers-color-scheme: dark)');

    // If the user has set a preference, use that, otherwise use system preference
    const shouldUseDarkMode = isDarkMode !== null ? isDarkMode : prefersColor.matches;

    this.setDarkMode(shouldUseDarkMode);

    // Listen for changes in system preference
    prefersColor.addEventListener('change', (e) => {
      // Only update if the user hasn't explicitly set a preference
      if (isDarkMode === null) {
        this.setDarkMode(e.matches);
      }
    });
  }

  isDarkMode() {
    return this.darkMode.asObservable();
  }

  setDarkMode(enable: boolean) {
    this.darkMode.next(enable);
    this.storageService.set('dark_mode', enable);

    if (enable) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  toggleDarkMode() {
    this.setDarkMode(!this.darkMode.value);
  }
}
