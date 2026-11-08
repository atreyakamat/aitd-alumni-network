import { describe, expect, it } from 'vitest';
import { batchLine, readConnections, readDirectory, readRequests, readYearbook, toPerson } from '@/lib/people';

// Shapes copied from the server's responses (server/tests/contract/response-shape.contract.test.ts)
const directoryRow = {
  id: 'u1',
  fullName: 'Asha Rao',
  profilePhotoUrl: '/uploads/profiles/a.png',
  batchYear: 2018,
  department: 'Computer Engineering',
  degree: 'B.E.',
  currentDesignation: 'Staff Engineer',
  city: 'Pune',
  membershipTier: null,
  workExperiences: [],
};

describe('toPerson', () => {
  it('maps the server field names to what the cards render', () => {
    expect(toPerson(directoryRow)).toEqual({
      id: 'u1',
      fullName: 'Asha Rao',
      avatarUrl: '/uploads/profiles/a.png',
      headline: 'Staff Engineer',
      department: 'Computer Engineering',
      batchYear: 2018,
      locationCity: 'Pune',
      locationCountry: null,
      skills: [],
    });
  });

  it('flattens skills given as strings or as { skill: { name } } rows', () => {
    expect(toPerson({ id: 'x', skills: ['SQL', { skill: { name: 'Go' } }, { name: 'Rust' }, 5] }).skills).toEqual(['SQL', 'Go', 'Rust']);
  });

  it('tolerates a missing or empty row', () => {
    expect(toPerson(undefined)).toMatchObject({ id: '', fullName: 'Alumnus', avatarUrl: null, headline: null });
  });
});

describe('readDirectory', () => {
  it('reads { data, pagination }', () => {
    const page = readDirectory({
      success: true,
      data: [directoryRow],
      pagination: { total: 25, page: 2, limit: 12, totalPages: 3, hasNextPage: true, hasPrevPage: true },
    });
    expect(page.people.map((p) => p.fullName)).toEqual(['Asha Rao']);
    expect(page).toMatchObject({ total: 25, page: 2, totalPages: 3 });
  });

  it('is empty for an error body', () => {
    expect(readDirectory(undefined)).toEqual({ people: [], total: 0, page: 1, totalPages: 0 });
  });
});

describe('readYearbook', () => {
  it('reads data.alumni', () => {
    expect(readYearbook({ data: { batchYear: 2018, count: 1, alumni: [directoryRow] } })[0].headline).toBe('Staff Engineer');
  });
  it('accepts a bare list', () => {
    expect(readYearbook({ data: [directoryRow] })).toHaveLength(1);
  });
});

describe('network payloads', () => {
  it('readConnections keeps the connection id and flattens the other user', () => {
    const rows = readConnections({
      data: [
        { connectionId: 'c1', connectedAt: '2026-01-01', id: 'u2', fullName: 'Ben Roy', profilePhotoUrl: null, currentDesignation: 'PM', city: 'Delhi' },
      ],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('c1');
    expect(rows[0].partner).toMatchObject({ id: 'u2', fullName: 'Ben Roy', headline: 'PM' });
  });

  it('readRequests splits received and sent and answers with the connection id', () => {
    const { received, sent } = readRequests({
      data: {
        received: [{ connectionId: 'c1', user: { id: 'u3', fullName: 'Cy Das', batchYear: 2015, department: 'Civil' }, createdAt: '2026-02-02' }],
        sent: [{ connectionId: 'c2', user: { id: 'u4', fullName: 'Di Eng' }, createdAt: '2026-02-03' }],
      },
    });
    expect(received.map((r) => [r.id, r.person.id])).toEqual([['c1', 'u3']]);
    expect(sent.map((r) => [r.id, r.person.id])).toEqual([['c2', 'u4']]);
  });

  it('readRequests copes with an error body', () => {
    expect(readRequests(undefined)).toEqual({ received: [], sent: [] });
  });
});

describe('batchLine', () => {
  it('skips unknown parts', () => {
    expect(batchLine({ batchYear: 2018, department: 'Civil' })).toBe('Class of 2018 • Civil');
    expect(batchLine({ batchYear: null, department: 'Civil' })).toBe('Civil');
    expect(batchLine({ batchYear: null, department: null })).toBe('');
  });
});
