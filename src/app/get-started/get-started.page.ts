import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { StorageService } from '../services/storage.service';

@Component({
  selector: 'app-get-started',
  templateUrl: './get-started.page.html',
  styleUrls: ['./get-started.page.scss'],
  standalone: false,
})
export class GetStartedPage implements OnInit {
  constructor(
    private router: Router,
    private storageService: StorageService
  ) {}

  ngOnInit() {
    // Check if the user has already completed onboarding
    this.checkFirstRun();
  }

  async checkFirstRun() {
    const hasCompletedOnboarding = await this.storageService.get('has_completed_onboarding');
    if (hasCompletedOnboarding) {
      this.router.navigate(['/tabs/home']);
    }
  }

  async getStarted() {
    await this.storageService.set('has_completed_onboarding', true);
    this.router.navigate(['/tabs/home']);
  }
}
