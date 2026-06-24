import { DockService } from './dock.service';
import { DOCK_STORAGE_KEY } from './dock.types';

describe('DockService', () => {
  let dock: DockService;

  beforeEach(() => {
    localStorage.removeItem(DOCK_STORAGE_KEY);
    dock = new DockService();
  });

  it('starts from the default layout', () => {
    expect(dock.zoneOf('tools')).toBe('left');
    expect(dock.zoneOf('timeline')).toBe('bottom');
    expect(dock.isHidden('adjust')).toBeTrue();
    expect(dock.isHidden('tilemap')).toBeTrue();
  });

  it('show() reveals a hidden panel into a zone', () => {
    dock.show('adjust');
    expect(dock.isHidden('adjust')).toBeFalse();
    expect(dock.zoneOf('adjust')).toBe('right');
  });

  it('show() is a no-op when the panel is already docked (documented gotcha)', () => {
    dock.show('adjust'); // docked into right
    dock.dock('adjust', 'left'); // user moved it
    dock.show('adjust'); // must NOT pull it back
    expect(dock.zoneOf('adjust')).toBe('left');
  });

  it('hide() detaches a panel and flags it hidden', () => {
    dock.hide('color');
    expect(dock.isHidden('color')).toBeTrue();
    expect(dock.zoneOf('color')).toBeNull();
  });

  it('toggleHidden() flips visibility', () => {
    expect(dock.isHidden('tilemap')).toBeTrue();
    dock.toggleHidden('tilemap');
    expect(dock.isHidden('tilemap')).toBeFalse();
    dock.toggleHidden('tilemap');
    expect(dock.isHidden('tilemap')).toBeTrue();
  });

  it('float() moves a panel out of its zone into floating', () => {
    dock.float('color', { x: 10, y: 10, w: 200, h: 200 });
    expect(dock.isFloating('color')).toBeTrue();
    expect(dock.zoneOf('color')).toBeNull();
  });

  it('toggleCollapse() toggles collapsed state', () => {
    expect(dock.isCollapsed('tools')).toBeFalse();
    dock.toggleCollapse('tools');
    expect(dock.isCollapsed('tools')).toBeTrue();
  });

  it('persists across instances and sanitizes (each panel referenced once)', () => {
    dock.show('adjust');
    dock.hide('generate');
    const restored = new DockService();
    expect(restored.isHidden('adjust')).toBeFalse();
    expect(restored.isHidden('generate')).toBeTrue();
    const all = [
      ...restored.state.zones.left,
      ...restored.state.zones.right,
      ...restored.state.zones.bottom,
      ...restored.state.floating.map((f) => f.id),
      ...restored.state.hidden,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
