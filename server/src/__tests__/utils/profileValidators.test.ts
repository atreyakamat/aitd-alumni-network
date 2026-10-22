import {
  educationSchema,
  idParamSchema,
  updateEducationSchema,
  updateProfileSchema,
  updateSkillsSchema,
  updateWorkExperienceSchema,
  workExperienceSchema,
} from '../../utils/validators';

const ID = '00000000-0000-4000-8000-00000000abcd';
const thisYear = new Date().getFullYear();

describe('profile validators', () => {
  describe('updateProfileSchema', () => {
    const parse = (body: Record<string, unknown>) => updateProfileSchema.safeParse({ body });

    it('strips system fields (no mass assignment)', () => {
      const result = parse({ city: 'Pune', userRole: 'SUPER_ADMIN', isVerified: true, email: 'x@evil.io', profileCompleteness: 100 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.body).toEqual({ city: 'Pune' });
    });

    it('accepts privacy settings', () => {
      const result = parse({ phoneVisibility: 'CONNECTIONS', isLocationPublic: true, locationLat: 28.614, locationLng: 77.209 });
      expect(result.success).toBe(true);
    });

    it('rejects unknown phone visibility and non-boolean location toggle', () => {
      expect(parse({ phoneVisibility: 'EVERYONE' }).success).toBe(false);
      expect(parse({ isLocationPublic: 'yes' }).success).toBe(false);
    });

    it.each([
      ['lat too high', { locationLat: 91 }],
      ['lat too low', { locationLat: -91 }],
      ['lng too high', { locationLng: 181 }],
      ['lng not a number', { locationLng: '77' }],
    ])('range-checks coordinates (%s)', (_label, body) => {
      expect(parse(body).success).toBe(false);
    });

    it('allows clearing coordinates with null', () => {
      expect(parse({ locationLat: null, locationLng: null }).success).toBe(true);
    });

    it.each(['javascript:alert(1)', 'ftp://example.com', 'not a url', `https://x.io/${'a'.repeat(200)}`])(
      'rejects non-http(s) or oversized links (%s)',
      (url) => {
        expect(parse({ linkedinUrl: url }).success).toBe(false);
        expect(parse({ websiteUrl: url }).success).toBe(false);
      }
    );

    it('accepts http/https links and turns blank strings into null', () => {
      const result = parse({ linkedinUrl: 'https://linkedin.com/in/ada', githubUrl: 'http://github.com/ada', twitterUrl: '  ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.linkedinUrl).toBe('https://linkedin.com/in/ada');
        expect(result.data.body.twitterUrl).toBeNull();
      }
    });

    it('limits bio length and trims text fields', () => {
      expect(parse({ shortBio: 'x'.repeat(501) }).success).toBe(false);
      const result = parse({ shortBio: '  Hello  ', currentDesignation: '  Engineer ', fullName: '  Ada Alum ' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.body.shortBio).toBe('Hello');
        expect(result.data.body.currentDesignation).toBe('Engineer');
        expect(result.data.body.fullName).toBe('Ada Alum');
      }
    });

    it('validates name, phone and secondary email', () => {
      expect(parse({ fullName: ' A ' }).success).toBe(false);
      expect(parse({ phoneNumber: 'call me' }).success).toBe(false);
      expect(parse({ phoneNumber: '+91 98765-43210' }).success).toBe(true);
      expect(parse({ secondaryEmail: 'nope' }).success).toBe(false);
      expect(parse({ secondaryEmail: '' }).success).toBe(true);
    });
  });

  describe('workExperienceSchema', () => {
    const valid = { company: 'Acme', role: 'Engineer', startDate: '2020-01-01' };
    const parse = (body: Record<string, unknown>) => workExperienceSchema.safeParse({ body: { ...valid, ...body } });

    it('accepts a date-only start date and coerces it to a Date', () => {
      const result = parse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.body.startDate).toEqual(new Date('2020-01-01T00:00:00.000Z'));
    });

    it('accepts full ISO datetimes', () => {
      const result = parse({ startDate: '2020-01-01T10:00:00.000Z', endDate: '2021-06-30T00:00:00+05:30' });
      expect(result.success).toBe(true);
    });

    it.each(['2020-13-01', '2021-02-30', 'yesterday', '01/02/2020', '', '1899-12-31'])('rejects bad dates (%s)', (startDate) => {
      expect(parse({ startDate }).success).toBe(false);
    });

    it('rejects an end date before the start date', () => {
      const result = parse({ startDate: '2021-01-01', endDate: '2020-01-01' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0].path).toEqual(['body', 'endDate']);
    });

    it('requires company and role and caps lengths', () => {
      expect(parse({ company: '  ' }).success).toBe(false);
      expect(workExperienceSchema.safeParse({ body: { company: 'A', startDate: '2020-01-01' } }).success).toBe(false);
      expect(parse({ role: 'x'.repeat(192) }).success).toBe(false);
      expect(parse({ description: 'x'.repeat(2001) }).success).toBe(false);
    });

    it('update schema accepts a partial body, requires a uuid id and at least one field', () => {
      const ok = updateWorkExperienceSchema.safeParse({ body: { endDate: '2022-05-01' }, params: { id: ID } });
      expect(ok.success).toBe(true);
      expect(updateWorkExperienceSchema.safeParse({ body: { role: 'R' }, params: { id: 'w1' } }).success).toBe(false);
      expect(updateWorkExperienceSchema.safeParse({ body: {}, params: { id: ID } }).success).toBe(false);
      expect(
        updateWorkExperienceSchema.safeParse({ body: { startDate: 'bad' }, params: { id: ID } }).success
      ).toBe(false);
    });
  });

  describe('educationSchema', () => {
    const valid = { institution: 'AITD', degree: 'B.Tech', startYear: 2015 };
    const parse = (body: Record<string, unknown>) => educationSchema.safeParse({ body: { ...valid, ...body } });

    it('accepts a valid education entry', () => {
      expect(parse({ endYear: 2019, fieldOfStudy: 'CS', grade: '8.5 CGPA', isPrimary: true }).success).toBe(true);
    });

    it('enforces the year range and order', () => {
      expect(parse({ startYear: 1899 }).success).toBe(false);
      expect(parse({ startYear: thisYear + 11 }).success).toBe(false);
      expect(parse({ startYear: 2015.5 }).success).toBe(false);
      expect(parse({ endYear: 2014 }).success).toBe(false);
      expect(parse({ endYear: null }).success).toBe(true);
    });

    it('update schema is partial and needs a uuid id', () => {
      expect(updateEducationSchema.safeParse({ body: { grade: 'A' }, params: { id: ID } }).success).toBe(true);
      expect(updateEducationSchema.safeParse({ body: { grade: 'A' }, params: { id: 'nope' } }).success).toBe(false);
    });
  });

  describe('updateSkillsSchema', () => {
    const parse = (skills: unknown) => updateSkillsSchema.safeParse({ body: { skills } });

    it('trims, collapses whitespace and de-duplicates case-insensitively', () => {
      const result = parse(['  React ', 'react', 'Node   JS', 'TypeScript']);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.body.skills).toEqual(['React', 'Node JS', 'TypeScript']);
    });

    it('accepts an empty list (clears skills)', () => {
      expect(parse([]).success).toBe(true);
    });

    it('rejects non-arrays, blank names, names over 50 chars and more than 50 skills', () => {
      expect(parse('React').success).toBe(false);
      expect(updateSkillsSchema.safeParse({ body: {} }).success).toBe(false);
      expect(parse(['  ']).success).toBe(false);
      expect(parse([42]).success).toBe(false);
      expect(parse(['x'.repeat(51)]).success).toBe(false);
      expect(parse(Array.from({ length: 51 }, (_, i) => `Skill ${i}`)).success).toBe(false);
    });

    it('counts the limit after de-duplication', () => {
      const skills = [...Array.from({ length: 50 }, (_, i) => `Skill ${i}`), 'skill 0'];
      expect(parse(skills).success).toBe(true);
    });
  });

  it('idParamSchema requires a uuid', () => {
    expect(idParamSchema.safeParse({ params: { id: ID } }).success).toBe(true);
    expect(idParamSchema.safeParse({ params: { id: '1 OR 1=1' } }).success).toBe(false);
  });
});
