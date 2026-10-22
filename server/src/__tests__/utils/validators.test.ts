import {
  forgotPasswordSchema,
  loginSchema,
  oauthExchangeSchema,
  refreshTokenSchema,
  registerSchema,
  resend2FASchema,
  resetPasswordSchema,
  verify2FASchema,
  verifyEmailSchema,
} from '../../utils/validators';

const validRegistration = {
  email: 'Alum@AITD.edu',
  password: 'Strong#Pass1',
  fullName: 'Ada Alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  degree: 'B.E.',
};

const parseRegister = (overrides: Record<string, unknown> = {}) =>
  registerSchema.safeParse({ body: { ...validRegistration, ...overrides } });

describe('auth validators', () => {
  describe('registerSchema', () => {
    it('accepts a valid registration and normalises the email', () => {
      const result = parseRegister({ email: '  Alum@AITD.edu ' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.body.email).toBe('alum@aitd.edu');
    });

    it.each([
      ['too short', 'Ab1'],
      ['no digit', 'NoDigitsHere'],
      ['no uppercase', 'lowercase123'],
      ['no lowercase', 'UPPERCASE123'],
      ['too long', `Aa1${'x'.repeat(200)}`],
    ])('rejects weak password (%s)', (_label, password) => {
      expect(parseRegister({ password }).success).toBe(false);
    });

    it.each([
      ['not an email', 'nope'],
      ['too long', `${'a'.repeat(250)}@x.io`],
    ])('rejects invalid email (%s)', (_label, email) => {
      expect(parseRegister({ email }).success).toBe(false);
    });

    it('enforces the batch year range', () => {
      const thisYear = new Date().getFullYear();
      expect(parseRegister({ batchYear: 1949 }).success).toBe(false);
      expect(parseRegister({ batchYear: 1950 }).success).toBe(true);
      expect(parseRegister({ batchYear: thisYear + 5 }).success).toBe(true);
      expect(parseRegister({ batchYear: thisYear + 6 }).success).toBe(false);
      expect(parseRegister({ batchYear: 2015.5 }).success).toBe(false);
      expect(parseRegister({ batchYear: '2015' }).success).toBe(false);
    });

    it('requires a non-blank name, department and degree', () => {
      expect(parseRegister({ fullName: '  A ' }).success).toBe(false);
      expect(parseRegister({ fullName: 'x'.repeat(101) }).success).toBe(false);
      expect(parseRegister({ department: '   ' }).success).toBe(false);
      expect(parseRegister({ degree: '' }).success).toBe(false);
    });

    it('only allows known role types', () => {
      expect(parseRegister({ roleType: 'STUDENT' }).success).toBe(true);
      expect(parseRegister({ roleType: 'ADMIN' }).success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('accepts any non-empty password (existing accounts may predate the policy)', () => {
      expect(loginSchema.safeParse({ body: { email: 'a@b.io', password: 'x' } }).success).toBe(true);
    });

    it('rejects empty and absurdly long passwords and bad emails', () => {
      expect(loginSchema.safeParse({ body: { email: 'a@b.io', password: '' } }).success).toBe(false);
      expect(loginSchema.safeParse({ body: { email: 'a@b.io', password: 'x'.repeat(1025) } }).success).toBe(false);
      expect(loginSchema.safeParse({ body: { email: 'bad', password: 'x' } }).success).toBe(false);
    });
  });

  it('forgotPasswordSchema requires a valid email', () => {
    expect(forgotPasswordSchema.safeParse({ body: { email: 'a@b.io' } }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ body: { email: '' } }).success).toBe(false);
  });

  it('resetPasswordSchema applies the strong password policy', () => {
    expect(resetPasswordSchema.safeParse({ body: { token: 't', password: 'Strong#Pass1' } }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ body: { token: 't', password: 'weakpassword' } }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ body: { token: '', password: 'Strong#Pass1' } }).success).toBe(false);
  });

  it('token schemas require non-empty, bounded tokens', () => {
    expect(verifyEmailSchema.safeParse({ body: { token: 'abc' } }).success).toBe(true);
    expect(verifyEmailSchema.safeParse({ body: { token: '' } }).success).toBe(false);
    expect(refreshTokenSchema.safeParse({ body: { refreshToken: 'abc' } }).success).toBe(true);
    expect(refreshTokenSchema.safeParse({ body: {} }).success).toBe(false);
    expect(oauthExchangeSchema.safeParse({ body: { code: 'abc' } }).success).toBe(true);
    expect(oauthExchangeSchema.safeParse({ body: { code: 'x'.repeat(257) } }).success).toBe(false);
    expect(resend2FASchema.safeParse({ body: { twoFactorToken: 'abc' } }).success).toBe(true);
    expect(resend2FASchema.safeParse({ body: { userId: 'abc' } }).success).toBe(false);
  });

  it('verify2FASchema requires a challenge token and a 6-digit code', () => {
    expect(verify2FASchema.safeParse({ body: { twoFactorToken: 't', otp: '012345' } }).success).toBe(true);
    expect(verify2FASchema.safeParse({ body: { twoFactorToken: 't', otp: '12345' } }).success).toBe(false);
    expect(verify2FASchema.safeParse({ body: { twoFactorToken: 't', otp: '12345a' } }).success).toBe(false);
    expect(verify2FASchema.safeParse({ body: { userId: 'u1', otp: '123456' } }).success).toBe(false);
  });
});
