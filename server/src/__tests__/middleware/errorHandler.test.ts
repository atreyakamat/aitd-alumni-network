import { z } from 'zod';
import { AppError, errorHandler } from '../../middleware/errorHandler';
import { validate } from '../../middleware/validate';
import {
  createEventSchema,
  createJobSchema,
  createPostSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../../utils/validators';
import { mockReqRes } from '../../../tests/helpers';

const handle = (err: Error) => {
  const { req, res, next } = mockReqRes();
  errorHandler(err, req, res, next);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
};

const namedError = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('raw internals'), { name, ...extra });

describe('AppError', () => {
  it('carries status, code and operational flag', () => {
    const err = new AppError('Nope', 418, 'TEAPOT');
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: 'Nope', statusCode: 418, code: 'TEAPOT', isOperational: true });
    expect(new AppError('x').statusCode).toBe(500);
  });
});

describe('errorHandler', () => {
  it('renders AppErrors with their status and code', () => {
    expect(handle(new AppError('Bad creds', 401, 'INVALID_CREDENTIALS'))).toEqual({
      status: 401,
      body: { success: false, error: { message: 'Bad creds', code: 'INVALID_CREDENTIALS' } },
    });
  });

  it('maps Prisma unique violations to 409 and not-found to 404', () => {
    expect(handle(namedError('PrismaClientKnownRequestError', { code: 'P2002' }))).toMatchObject({
      status: 409,
      body: { error: { code: 'DUPLICATE_ENTRY' } },
    });
    expect(handle(namedError('PrismaClientKnownRequestError', { code: 'P2025' }))).toMatchObject({
      status: 404,
      body: { error: { code: 'NOT_FOUND' } },
    });
  });

  it('maps raw JWT errors to 401', () => {
    expect(handle(namedError('JsonWebTokenError'))).toMatchObject({ status: 401, body: { error: { code: 'INVALID_TOKEN' } } });
    expect(handle(namedError('TokenExpiredError'))).toMatchObject({ status: 401, body: { error: { code: 'TOKEN_EXPIRED' } } });
  });

  it('maps malformed JSON bodies to 400 instead of 500', () => {
    expect(handle(namedError('SyntaxError', { type: 'entity.parse.failed', status: 400 }))).toEqual({
      status: 400,
      body: { success: false, error: { message: 'Malformed JSON in request body', code: 'INVALID_JSON' } },
    });
  });

  it('maps oversized bodies to 413', () => {
    expect(handle(namedError('PayloadTooLargeError', { type: 'entity.too.large' }))).toMatchObject({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE' } },
    });
  });

  it('maps upload limits (multer) to client errors instead of 500', () => {
    expect(handle(namedError('MulterError', { code: 'LIMIT_FILE_SIZE' }))).toMatchObject({
      status: 413,
      body: { error: { code: 'FILE_TOO_LARGE' } },
    });
    expect(handle(namedError('MulterError', { code: 'LIMIT_UNEXPECTED_FILE' }))).toMatchObject({
      status: 400,
      body: { error: { code: 'UPLOAD_ERROR' } },
    });
  });

  it('maps ZodErrors to 400 VALIDATION_ERROR with field details', () => {
    const parsed = z.object({ email: z.string().email() }).safeParse({ email: 'x' });
    const { status, body } = handle((parsed as any).error);
    expect(status).toBe(400);
    expect(body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ field: 'email', message: expect.any(String) }] });
  });

  it('hides internal messages in production', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(handle(new Error('SELECT * FROM secrets'))).toEqual({
        status: 500,
        body: { success: false, error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } },
      });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('shows the message outside production', () => {
    expect(handle(new Error('debuggable'))).toMatchObject({ status: 500, body: { error: { message: 'debuggable' } } });
  });

  it('falls through to 500 for unknown Prisma codes', () => {
    expect(handle(namedError('PrismaClientKnownRequestError', { code: 'P2003' })).status).toBe(500);
  });
});

describe('validate', () => {
  const schema = z.object({
    body: z.object({ email: z.string().email() }),
  });

  it('calls next() when the request is valid', () => {
    const { req, res, next } = mockReqRes({ body: { email: 'a@b.io' } });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('responds 400 VALIDATION_ERROR with dotted field paths', () => {
    const { req, res, next } = mockReqRes({ body: { email: 'nope' } });
    validate(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: [{ field: 'body.email', message: expect.any(String) }],
      },
    });
  });

  it('forwards non-Zod errors to next()', () => {
    const boom = new Error('refine blew up');
    const exploding = { parse: () => { throw boom; } } as any;
    const { req, res, next } = mockReqRes();
    validate(exploding)(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe('validate: parsed body replaces req.body (mass-assignment guard)', () => {
  const SMUGGLED = { userRole: 'SUPER_ADMIN', isActive: true, isVerified: true, id: 'other', passwordHash: 'x' };

  const run = (schema: any, body: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const { req, res, next } = mockReqRes({ body, ...extra });
    validate(schema)(req, res, next);
    expect(next).toHaveBeenCalledWith();
    return req;
  };

  it('strips unknown keys and keeps every legitimate profile field', () => {
    const legit = {
      fullName: 'Ada Alum',
      profilePhotoUrl: 'https://cdn.example.com/a.png',
      coverPhotoUrl: null,
      currentDesignation: 'Engineer',
      shortBio: 'Hello',
      city: 'Goa',
      hometown: 'Panaji',
      locationLat: 15.49,
      locationLng: 73.82,
      isLocationPublic: true,
      phoneNumber: '+91 99999 99999',
      phoneVisibility: 'CONNECTIONS',
      linkedinUrl: 'https://linkedin.com/in/ada',
      twitterUrl: 'https://twitter.com/ada',
      githubUrl: 'https://github.com/ada',
      websiteUrl: 'https://ada.dev',
      secondaryEmail: 'ada@alt.io',
    };
    const req = run(updateProfileSchema, { ...legit, ...SMUGGLED });
    expect(req.body).toEqual(legit);
  });

  it('keeps every createEvent field the service accepts', () => {
    const legit = {
      title: 'Reunion',
      description: 'Annual meet',
      bannerUrl: 'https://cdn.example.com/b.png',
      eventType: 'HYBRID',
      venue: 'Hall',
      address: 'Main road',
      city: 'Goa',
      joinLink: 'https://meet.example.com/x',
      startDate: '2030-01-01T10:00:00.000Z',
      endDate: '2030-01-01T12:00:00.000Z',
      capacity: 100,
      tags: ['alumni'],
      isPublic: false,
      chapterId: '00000000-0000-4000-8000-000000000001',
    };
    expect(run(createEventSchema, { ...legit, createdById: 'x', status: 'DRAFT' }).body).toEqual(legit);
  });

  it('keeps every createJob field the service accepts', () => {
    const legit = {
      title: 'SDE',
      description: 'Build things',
      company: 'Acme',
      location: 'Remote',
      workplaceType: 'REMOTE',
      jobType: 'FULL_TIME',
      industry: 'Software',
      salaryMin: 10,
      salaryMax: 20,
      experienceMin: 1,
      experienceMax: 3,
      skills: ['ts'],
      applicationLink: 'https://acme.example.com/apply',
      deadline: '2030-01-01T00:00:00.000Z',
    };
    expect(run(createJobSchema, { ...legit, status: 'PUBLISHED', isFeatured: true, postedById: 'x' }).body).toEqual(legit);
  });

  it('keeps every createPost field the service accepts', () => {
    const legit = { type: 'GENERAL', content: 'Hi', mediaUrls: ['https://cdn.example.com/m.png'], linkUrl: 'https://x.io' };
    expect(run(createPostSchema, { ...legit, likesCount: 999, userId: 'x' }).body).toEqual(legit);
  });

  it('strips privileged keys from registration and applies normalisation', () => {
    const req = run(registerSchema, {
      email: '  New@AITD.edu ',
      password: 'Strong#Pass1',
      fullName: ' New Alum ',
      batchYear: 2020,
      department: 'IT',
      degree: 'B.E.',
      roleType: 'STUDENT',
      ...SMUGGLED,
    });
    expect(req.body).toEqual({
      email: 'new@aitd.edu',
      password: 'Strong#Pass1',
      fullName: 'New Alum',
      batchYear: 2020,
      department: 'IT',
      degree: 'B.E.',
      roleType: 'STUDENT',
    });
  });

  it('does not alter query or params', () => {
    const query = { page: '2', extra: 'kept' };
    const params = { id: 'abc' };
    const req = run(loginSchema, { email: 'a@b.io', password: 'x' }, { query, params });
    expect(req.query).toBe(query);
    expect(req.params).toBe(params);
  });

  it('leaves req.body alone for schemas without a body', () => {
    const body = { anything: 1 };
    const req = run(z.object({ params: z.object({}).passthrough() }), body);
    expect(req.body).toBe(body);
  });
});
