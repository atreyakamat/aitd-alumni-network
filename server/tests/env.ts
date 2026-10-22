// Loaded before any module so config/index.ts picks up deterministic values.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-that-is-long-enough-123';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-that-is-long-enough';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.DISABLE_RATE_LIMIT = 'true';
delete process.env.REDIS_URL;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.GOOGLE_CLIENT_ID;
delete process.env.LINKEDIN_CLIENT_ID;
