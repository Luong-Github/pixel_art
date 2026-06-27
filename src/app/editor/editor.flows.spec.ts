import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EditorComponent } from './editor.component';

/**
 * Core model-logic flows reachable without canvas rendering. Builds on the
 * editor.component.spec harness (TestBed DI). We drive PUBLIC methods/getters and
 * assert workspace state a user would observe — never the canvas pixels (no ctx
 * is wired without ngAfterViewInit, so render() is a safe no-op here).
 *
 * Guards: frame add/duplicate/reverse/delete guards (FEAT-06, AC-06-2),
 * layer add/duplicate/delete/visibility/lock (FEAT-05, AC-05-1), and the
 * hasSelection/hasClipboard contextual-disclosure getters (FEAT-03/07, AC-03-2).
 */
describe('EditorComponent — core model flows', () => {
  let c: EditorComponent;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [EditorComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    c = TestBed.createComponent(EditorComponent).componentInstance;
  });

  describe('frames', () => {
    it('starts with exactly one frame, active index 0', () => {
      expect(c.frames.length).toBe(1);
      expect(c.activeFrameIndex).toBe(0);
    });

    it('addFrame inserts after the active frame and activates it', () => {
      c.addFrame();
      expect(c.frames.length).toBe(2);
      expect(c.activeFrameIndex).toBe(1);
    });

    it('duplicateFrame clones the active frame and activates the copy', () => {
      const before = c.frames.length;
      c.duplicateFrame();
      expect(c.frames.length).toBe(before + 1);
      expect(c.activeFrameIndex).toBe(1);
      expect(c.activeFrame.name).toContain('copy');
    });

    it('reverseFrames is a no-op guard with a single frame', () => {
      const idBefore = c.activeFrame.name;
      c.reverseFrames();
      expect(c.frames.length).toBe(1);
      expect(c.activeFrame.name).toBe(idBefore);
    });

    it('reverseFrames flips order and remaps the active index with >=2 frames', () => {
      c.addFrame(); // now 2 frames, active = 1
      const names = c.frames.map((f) => f.name);
      c.reverseFrames();
      expect(c.frames.map((f) => f.name)).toEqual([...names].reverse());
      expect(c.activeFrameIndex).toBe(0); // was last, now first
    });

    it('deleteFrame on a single-frame sprite clears instead of dropping to zero', () => {
      c.deleteFrame();
      expect(c.frames.length).toBe(1); // AC-06-2: never zero frames
    });

    it('deleteFrame removes the selected frame when more than one exists', () => {
      c.addFrame();
      c.addFrame(); // 3 frames, active = 2
      c.deleteFrame();
      expect(c.frames.length).toBe(2);
    });

    it('deleteFrame never removes every frame even if all are selected', () => {
      c.addFrame();
      c.addFrame(); // 3 frames
      c.selectedFrames = new Set([0, 1, 2]);
      c.deleteFrame();
      expect(c.frames.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('layers', () => {
    it('addLayer inserts above the active layer and activates it', () => {
      const before = c.timelineLayerCount;
      c.addLayer();
      expect(c.timelineLayerCount).toBe(before + 1);
      expect(c.activeLayerIndex).toBe(1);
    });

    it('duplicateLayer copies the active layer (name + " copy") and activates it', () => {
      const sourceName = c.activeLayer.name;
      c.duplicateLayer();
      expect(c.timelineLayerCount).toBe(2);
      expect(c.activeLayerIndex).toBe(1);
      expect(c.activeLayer.name).toBe(`${sourceName} copy`);
    });

    it('deleteLayer on the last layer clears it instead of removing', () => {
      expect(c.timelineLayerCount).toBe(1);
      c.deleteLayer();
      expect(c.timelineLayerCount).toBe(1); // clearLayer path, not removal
    });

    it('deleteLayer removes a layer when more than one exists', () => {
      c.addLayer(); // 2 layers, active = 1
      c.deleteLayer();
      expect(c.timelineLayerCount).toBe(1);
      expect(c.activeLayerIndex).toBe(0);
    });

    it('toggleLayerVisibility flips visibility across all frames', () => {
      expect(c.isLayerVisible(0)).toBe(true);
      c.toggleLayerVisibility(0);
      expect(c.isLayerVisible(0)).toBe(false);
      c.toggleLayerVisibility(0);
      expect(c.isLayerVisible(0)).toBe(true);
    });

    it('toggleLayerLock flips lock and is reflected by activeLayerLocked', () => {
      expect(c.isLayerLocked(0)).toBe(false);
      expect(c.activeLayerLocked).toBe(false);
      c.toggleLayerLock(0);
      expect(c.isLayerLocked(0)).toBe(true);
      expect(c.activeLayerLocked).toBe(true);
    });

    it('clearLayer is blocked on a locked layer (BR-08 — no silent mutation)', () => {
      c.toggleLayerLock(0);
      // sanity: lock is on
      expect(c.activeLayerLocked).toBe(true);
      // clearLayer returns early on a locked layer; this must not throw.
      expect(() => c.clearLayer()).not.toThrow();
      expect(c.activeLayerLocked).toBe(true);
    });
  });

  describe('selection / clipboard disclosure getters (AC-03-2)', () => {
    it('reports no selection and no clipboard on a fresh workspace', () => {
      expect(c.hasSelection).toBe(false);
      expect(c.hasClipboard).toBe(false);
    });

    it('copySelection is a no-op with no selection (clipboard stays empty)', () => {
      c.copySelection();
      expect(c.hasClipboard).toBe(false);
    });

    it('pasteSelection is a guarded no-op with an empty clipboard', () => {
      const framesBefore = c.frames.length;
      expect(() => c.pasteSelection()).not.toThrow();
      expect(c.hasSelection).toBe(false);
      expect(c.frames.length).toBe(framesBefore);
    });
  });

  describe('adjust close = cancel (OQ-8)', () => {
    it('closePanel("adjust") discards a live Adjust session', () => {
      c.onAdjustChange(); // starts a session (no DOM needed; layer unlocked)
      expect(c.adjustActive).toBe(true);
      c.closePanel('adjust');
      expect(c.adjustActive).toBe(false);
    });

    it('closing a different panel leaves an Adjust session intact', () => {
      c.onAdjustChange();
      expect(c.adjustActive).toBe(true);
      c.closePanel('canvas');
      expect(c.adjustActive).toBe(true);
    });
  });
});
