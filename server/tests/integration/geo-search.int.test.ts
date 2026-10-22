/**
 * The alumni map's geospatial SQL and PostgreSQL-specific search semantics, against a real
 * PostgreSQL database (unit tests can only inspect the generated SQL text).
 */
import { createUser, http, prisma } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

// A department unique to this run keeps the assertions independent of other suites' rows
const DEPT = `GeoDept-${Date.now()}`;

const placeUser = (name: string, lat: number, lng: number, overrides: Record<string, unknown> = {}) =>
  createUser('MEMBER', {
    fullName: name,
    department: DEPT,
    city: name.split(' ')[0],
    locationLat: lat,
    locationLng: lng,
    isLocationPublic: true,
    ...overrides,
  });

describe('alumni nearby (haversine + bounding box on PostgreSQL)', () => {
  let viewer: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    viewer = await createUser('MEMBER');
    await placeUser('Pune Alumnus', 18.52, 73.86, { batchYear: 2015 });
    await placeUser('Mumbai Alumnus', 19.08, 72.88, { batchYear: 2016 });
    await placeUser('Pune Hidden', 18.53, 73.85, { isLocationPublic: false });
    await placeUser('Pune Deactivated', 18.51, 73.87, { isActive: false });
    await placeUser('Fiji East', -17.8, 179.95);
    await placeUser('Fiji West', -17.8, -179.95);
  });

  const nearby = (query: Record<string, string | number>) =>
    http()
      .get('/api/users/nearby')
      .query({ department: DEPT, ...query })
      .set('Authorization', viewer.auth);

  it('returns only public, active alumni inside the radius, nearest first', async () => {
    const small = await nearby({ lat: 18.52, lng: 73.86, radius: 50 });
    expect(small.status).toBe(200);
    expect(small.body.data.alumni.map((a: any) => a.fullName)).toEqual(['Pune Alumnus']);
    expect(small.body.data.alumni[0].distanceKm).toBe(0);

    const wide = await nearby({ lat: 18.52, lng: 73.86, radius: 200 });
    const names = wide.body.data.alumni.map((a: any) => a.fullName);
    expect(names).toEqual(['Pune Alumnus', 'Mumbai Alumnus']);
    // Pune -> Mumbai is ~120 km great-circle
    expect(wide.body.data.alumni[1].distanceKm).toBeGreaterThan(110);
    expect(wide.body.data.alumni[1].distanceKm).toBeLessThan(130);
    expect(JSON.stringify(wide.body)).not.toMatch(/Hidden|Deactivated|phoneNumber|"email"/);
  });

  it('applies batch-year and case-insensitive name/city filters', async () => {
    const byBatch = await nearby({ lat: 18.52, lng: 73.86, radius: 200, batchYear: 2016 });
    expect(byBatch.body.data.alumni.map((a: any) => a.fullName)).toEqual(['Mumbai Alumnus']);

    const byCity = await nearby({ lat: 18.52, lng: 73.86, radius: 200, search: 'mUmBaI' });
    expect(byCity.body.data.alumni.map((a: any) => a.fullName)).toEqual(['Mumbai Alumnus']);

    // LIKE wildcards in the search are literal, not "match everything"
    const wildcard = await nearby({ lat: 18.52, lng: 73.86, radius: 200, search: '%' });
    expect(wildcard.body.data.count).toBe(0);
  });

  it('finds alumni across the antimeridian', async () => {
    const res = await nearby({ lat: -17.8, lng: 179.99, radius: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.alumni.map((a: any) => a.fullName).sort()).toEqual(['Fiji East', 'Fiji West']);
  });

  it('serves map viewports, including one that wraps the antimeridian', async () => {
    const india = await http()
      .get('/api/users/locations')
      .query({ north: 20, south: 18, east: 74, west: 72, department: DEPT })
      .set('Authorization', viewer.auth);
    expect(india.status).toBe(200);
    expect(india.body.data.map((a: any) => a.fullName).sort()).toEqual(['Mumbai Alumnus', 'Pune Alumnus']);

    const pacific = await http()
      .get('/api/users/locations')
      .query({ north: -17, south: -18, east: -179, west: 179, department: DEPT })
      .set('Authorization', viewer.auth);
    expect(pacific.body.data.map((a: any) => a.fullName).sort()).toEqual(['Fiji East', 'Fiji West']);
  });
});

describe('location privacy', () => {
  it('stores a shared location rounded to ~1 km', async () => {
    const member = await createUser('MEMBER');
    const res = await http()
      .patch('/api/users/profile')
      .set('Authorization', member.auth)
      .send({ locationLat: 18.521374, locationLng: 73.856749, isLocationPublic: true });
    expect(res.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect(stored.locationLat?.toString()).toBe('18.52');
    expect(stored.locationLng?.toString()).toBe('73.86');
  });
});

describe('case-insensitive search on PostgreSQL', () => {
  it('finds directory members regardless of case', async () => {
    const viewer = await createUser('MEMBER');
    const token = `Zyxwv${Date.now()}`;
    await createUser('MEMBER', { fullName: `${token} Person` });

    const res = await http()
      .get('/api/users/directory')
      .query({ name: token.toLowerCase() })
      .set('Authorization', viewer.auth);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(`${token} Person`);
  });

  it('reuses a skill whose name differs only by case', async () => {
    const skill = `TypeScriptXyz${Date.now()}`;
    const first = await createUser('MEMBER');
    const second = await createUser('MEMBER');

    await http().put('/api/users/skills').set('Authorization', first.auth).send({ skills: [skill] }).expect(200);
    await http()
      .put('/api/users/skills')
      .set('Authorization', second.auth)
      .send({ skills: [skill.toLowerCase()] })
      .expect(200);

    const rows = await prisma.skill.findMany({ where: { name: { equals: skill, mode: 'insensitive' } } });
    expect(rows.map((r) => r.name)).toEqual([skill]);
  });
});
