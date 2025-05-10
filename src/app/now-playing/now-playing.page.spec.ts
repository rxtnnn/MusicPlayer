import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NowPlayingPage } from './now-playing.page';

describe('NowPlayingPage', () => {
  let component: NowPlayingPage;
  let fixture: ComponentFixture<NowPlayingPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(NowPlayingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
