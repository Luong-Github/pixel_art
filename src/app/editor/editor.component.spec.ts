import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EditorComponent } from './editor.component';

/**
 * Smoke test — proves the component wires up (DI, providers, constructor) under
 * TestBed. Catches gross breakage (missing provider, constructor throw) without
 * driving the full canvas render. Deeper flow specs (Adjust / Convert) can build
 * on this harness.
 */
describe('EditorComponent (smoke)', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [EditorComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('constructs with all dependencies wired', () => {
    const fixture = TestBed.createComponent(EditorComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exposes the default workspace state', () => {
    const c = TestBed.createComponent(EditorComponent).componentInstance;
    expect(c.width).toBeGreaterThan(0);
    expect(c.height).toBeGreaterThan(0);
    expect(c.frames.length).toBeGreaterThan(0);
  });
});
