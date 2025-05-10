import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PlaylistsPage } from './playlist.page';

describe('PlaylistPage', () => {
  let component: PlaylistsPage;
  let fixture: ComponentFixture<PlaylistsPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(PlaylistsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
