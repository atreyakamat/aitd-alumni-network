export const API = (process.env.E2E_API_URL || 'http://localhost:5050/api').replace(/\/$/, '');
export const ADMIN = { email: process.env.E2E_ADMIN_EMAIL || '', password: process.env.E2E_ADMIN_PASSWORD || '' };
export const hasAdmin = Boolean(ADMIN.email && ADMIN.password);
/** A password that satisfies the policy, generated per run so nothing sensitive is stored in the repository. */
export const throwawayPassword = () => `Aa1!${Math.random().toString(36).slice(2)}${Date.now().toString(36)}Zz`;
export const throwawayEmail = () => `e2e.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}@example.com`;
