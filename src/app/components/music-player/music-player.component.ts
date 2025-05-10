import { Component, OnInit, Input } from '@angular/core';

@Component({
  selector: 'app-music-player',
  templateUrl: './music-player.component.html',
  styleUrls: ['./music-player.component.scss'],
  standalone: false
})
export class MusicPlayerComponent implements OnInit {
  @Input() song: any;
  isPlaying = true;
  currentTime = 0;
  duration = 238; // Duration in seconds
  isLiked = false;

  constructor() { }

  ngOnInit() {}

  togglePlay() {
    this.isPlaying = !this.isPlaying;
  }

  toggleLike() {
    this.isLiked = !this.isLiked;
  }

  formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
  }
}
