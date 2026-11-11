import { describe, expect, it } from 'vitest';
import { deriveOverall, normalizeSystemStatus } from '@/lib/system-status';

describe('deriveOverall', () => {
  it('is the worst state among the services', () => {
    expect(deriveOverall([{ status: 'ok' }, { status: 'warning' }, { status: 'error' }])).toBe('error');
    expect(deriveOverall([{ status: 'ok' }, { status: 'warning' }])).toBe('warning');
    expect(deriveOverall([{ status: 'ok' }, { status: 'ok' }])).toBe('ok');
  });

  it('does not count a service that is not in use', () => {
    expect(deriveOverall([{ status: 'ok' }, { status: 'off' }])).toBe('ok');
    expect(deriveOverall([])).toBe('ok');
  });
});

describe('normalizeSystemStatus', () => {
  it('keeps a well-formed report as it is', () => {
    const report = {
      checkedAt: '2026-11-09T10:32:15.000Z',
      environment: 'production',
      version: '1.4.2',
      uptimeSeconds: 120,
      overall: 'warning',
      services: [{ key: 'email', label: 'E-mail', status: 'warning', detail: 'Slow.' }],
    };
    expect(normalizeSystemStatus(report)).toEqual(report);
  });

  it('never shows a service of unknown state as working', () => {
    const s = normalizeSystemStatus({ services: [{ key: 'x', label: 'X', status: 'great', detail: 'ok' }] });
    expect(s.services[0].status).toBe('warning');
    expect(s.overall).toBe('warning');
  });

  it('survives junk', () => {
    for (const raw of [undefined, null, 'nope', 42, { services: 'x' }, { services: [null, 3] }]) {
      const s = normalizeSystemStatus(raw);
      expect(s.services).toEqual([]);
      expect(s.overall).toBe('ok');
      expect(s.uptimeSeconds).toBe(0);
    }
  });

  it('fills a missing label from the key, and a missing key from the position', () => {
    const s = normalizeSystemStatus({ services: [{ key: 'database', status: 'ok' }, { label: 'No key', status: 'ok' }] });
    expect(s.services[0]).toMatchObject({ key: 'database', label: 'database', detail: '' });
    expect(s.services[1].key).toBe('service-1');
  });
});
