import { createJobSchema, createEventSchema, updatePostSchema } from '../../utils/validators';
import { validate } from '../../middleware/validate';

/**
 * Round 3, R3-01: a list in a request body without a limit lets one 1 MB request make the server allocate hundreds of
 * megabytes (zod collects one issue per element) and answer with a response as large. Every list has a bound, and the
 * bound is checked before the elements are.
 */
const job = (skills: unknown) => ({ body: { title: 'Engineer', description: 'Build things', company: 'ACME', skills }, query: {}, params: {} });
const event = (tags: unknown) => ({ body: { title: 'Meet', description: 'Meet up', startDate: new Date().toISOString(), tags }, query: {}, params: {} });

describe('lists in request bodies are bounded', () => {
  it('job skills: up to 50 entries of up to 100 characters', () => {
    expect(createJobSchema.safeParse(job(Array.from({ length: 50 }, (_, i) => `skill-${i}`))).success).toBe(true);
    expect(createJobSchema.safeParse(job(Array.from({ length: 51 }, (_, i) => `s${i}`))).success).toBe(false);
    expect(createJobSchema.safeParse(job(['x'.repeat(101)])).success).toBe(false);
  });

  it('event tags: up to 20 entries of up to 50 characters', () => {
    expect(createEventSchema.safeParse(event(Array.from({ length: 20 }, (_, i) => `t${i}`))).success).toBe(true);
    expect(createEventSchema.safeParse(event(Array.from({ length: 21 }, (_, i) => `t${i}`))).success).toBe(false);
    expect(createEventSchema.safeParse(event(['x'.repeat(51)])).success).toBe(false);
  });

  it('post media on update: at most 10, like on create', () => {
    const body = (mediaUrls: unknown[]) => ({ body: { mediaUrls }, query: {}, params: {} });
    expect(updatePostSchema.safeParse(body(Array.from({ length: 11 }, () => '/uploads/posts/a.png'))).success).toBe(false);
  });

  it('a hostile list is refused without one issue per element', () => {
    const hostile = Array.from({ length: 200_000 }, (_, i) => i); // numbers where strings are expected
    const result = createJobSchema.safeParse(job(hostile));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.length).toBeLessThanOrEqual(5);
  });
});

describe('validation errors stay small', () => {
  it('answers with at most 20 details, each truncated', () => {
    const body = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    // a schema that fails on a hundred fields
    const { z } = require('zod');
    const schema = z.object({ body: z.object(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, z.string()]))), query: z.any(), params: z.any() });
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validate(schema)({ body, query: {}, params: {} } as any, res, jest.fn());
    const sent = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(400);
    expect(sent.error.details).toHaveLength(20);
    expect(JSON.stringify(sent).length).toBeLessThan(5_000);
  });
});
