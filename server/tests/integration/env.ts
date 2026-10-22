// Points Prisma at the database started by globalSetup (passed via the
// environment, which Jest workers inherit, so concurrent runs never collide).
const url = process.env.AITD_INTEGRATION_DATABASE_URL;
if (!url) throw new Error('AITD_INTEGRATION_DATABASE_URL is not set; run via jest.integration.config.js');
process.env.DATABASE_URL = url;
