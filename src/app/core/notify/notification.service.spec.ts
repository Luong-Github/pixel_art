import { fakeAsync, tick } from '@angular/core/testing';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let n: NotificationService;

  beforeEach(() => {
    n = new NotificationService();
  });

  it('pushes a success toast (not sticky)', () => {
    const id = n.success('done');
    const t = n.toasts();
    expect(t.length).toBe(1);
    expect(t[0].kind).toBe('success');
    expect(t[0].sticky).toBeFalse();
    expect(t[0].id).toBe(id);
  });

  it('errors are sticky by default', () => {
    n.error('oops');
    expect(n.toasts()[0].sticky).toBeTrue();
  });

  it('dismiss() removes a toast', () => {
    const id = n.info('hi');
    n.dismiss(id);
    expect(n.toasts().length).toBe(0);
  });

  it('caps the stack at 4, evicting the oldest non-sticky', () => {
    const first = n.success('1');
    n.success('2');
    n.success('3');
    n.success('4');
    n.success('5');
    const t = n.toasts();
    expect(t.length).toBe(4);
    expect(t.find((x) => x.id === first)).toBeUndefined();
  });

  it('keeps sticky toasts when capping', () => {
    const err = n.error('keep me');
    n.success('1');
    n.success('2');
    n.success('3');
    n.success('4');
    const t = n.toasts();
    expect(t.length).toBe(4);
    expect(t.find((x) => x.id === err)).toBeDefined();
  });

  it('update() converts a loading toast to success (no longer sticky)', () => {
    const id = n.loading('working');
    expect(n.toasts()[0].sticky).toBeTrue();
    n.update(id, { kind: 'success', message: 'ok' });
    const t = n.toasts()[0];
    expect(t.kind).toBe('success');
    expect(t.message).toBe('ok');
    expect(t.sticky).toBeFalse();
  });

  it('auto-dismisses success after 3s', fakeAsync(() => {
    n.success('bye');
    expect(n.toasts().length).toBe(1);
    tick(3000);
    expect(n.toasts().length).toBe(0);
  }));

  it('does not auto-dismiss errors', fakeAsync(() => {
    n.error('stay');
    tick(10000);
    expect(n.toasts().length).toBe(1);
  }));
});
