// One signed-in identity for the live probe: logs in ONCE, then keeps the access token fresh with the refresh token.
//
// Why it matters: the API allows 10 sign-in attempts per 15 minutes per address, and a production-like stack issues
// 15-minute access tokens, so a probe that takes longer than that would otherwise start to see 401s that are not findings.
// The refresh token is rotating and a reused one revokes the whole family, so a refresh is never repeated with an old
// token. If the session cannot be refreshed the identity is marked lost (there is deliberately NO second login).

import { ROLE_RANK } from './probe-plan.mjs';

/** Expiry (epoch ms) of a JWT, read WITHOUT verifying it (only used to refresh early). null when not a JWT. */
export function jwtExpiryMs(token) {
  const parts = String(token ?? '').split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** A safe one-line description of a response body for reports: never echoes data, only error codes and shapes. */
export function describeBody(text) {
  if (!text) return 'empty body';
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object') {
      if (json.error && typeof json.error === 'object') {
        const code = typeof json.error.code === 'string' ? json.error.code : '';
        const message = typeof json.error.message === 'string' ? json.error.message.slice(0, 80) : '';
        return `${code}${code && message ? ': ' : ''}${message}`.trim() || 'JSON error';
      }
      return `JSON ${text.length} bytes, keys: ${Object.keys(json).slice(0, 6).join(',')}`;
    }
  } catch {
    /* not JSON */
  }
  return `non-JSON ${text.length} bytes`;
}

export class Session {
  /**
   * @param {{ name: string, email: string, password: string, client: ReturnType<import('./http-client.mjs').createClient>,
   *           log?: (msg: string) => void, now?: () => number }} options
   */
  constructor({ name, email, password, client, log = () => {}, now = Date.now, minRenewGapMs = 30_000 }) {
    this.name = name;
    this.email = email;
    this.password = password;
    this.client = client;
    this.log = log;
    this.now = now;
    this.minRenewGapMs = minRenewGapMs; // a token renewed more recently than this is never renewed again (no refresh storms)
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAtMs = null;
    this.role = null;
    this.lost = null; // reason string once the session cannot be kept alive
    this.lastRenewedAt = 0;
    this.refreshes = 0;
  }

  get rank() {
    return ROLE_RANK[this.role] ?? null;
  }

  /** Sign in (once). Returns null on success or a human-readable reason. */
  async login() {
    const answer = await this.client.request({ method: 'POST', path: '/auth/login', body: { email: this.email, password: this.password } });
    let json = null;
    try {
      json = JSON.parse(answer.text);
    } catch {
      /* handled below */
    }
    if (answer.status !== 200 || !json?.data) {
      return `login failed for ${this.name} (${this.email}): HTTP ${answer.status} ${describeBody(answer.text)}`;
    }
    if (json.data.requires2FA) {
      return `login for ${this.name} needs a second factor; use a test account without 2FA`;
    }
    if (!json.data.accessToken || !json.data.refreshToken) {
      return `login for ${this.name} returned no tokens`;
    }
    this.accessToken = json.data.accessToken;
    this.refreshToken = json.data.refreshToken;
    this.expiresAtMs = jwtExpiryMs(this.accessToken);
    this.lastRenewedAt = this.now();
    this.role = json.data.user?.userRole ?? null;
    if (!this.role) {
      const me = await this.client.request({ path: '/auth/me', token: this.accessToken });
      try {
        const body = JSON.parse(me.text);
        this.role = body?.data?.userRole ?? body?.data?.user?.userRole ?? null;
      } catch {
        /* role stays unknown */
      }
    }
    if (!(this.role in ROLE_RANK)) return `could not determine the role of ${this.name} (${this.email})`;
    return null;
  }

  /** Renew the access token when it is about to expire. */
  async ensureFresh() {
    if (this.lost || this.expiresAtMs === null) return;
    if (this.now() > this.expiresAtMs - 90_000 && this.now() - this.lastRenewedAt >= this.minRenewGapMs) await this.refresh('access token about to expire');
  }

  /** After an unexpected 401: renew once (not more often than every minRenewGapMs, 30 s by default). Returns true when a new token is in place. */
  async renewAfter401() {
    if (this.lost) return false;
    if (this.now() - this.lastRenewedAt < this.minRenewGapMs) return false; // a fresh token that is still refused is a finding, not expiry
    return this.refresh('401 received');
  }

  async refresh(why) {
    if (this.lost) return false;
    const answer = await this.client.request({ method: 'POST', path: '/auth/refresh-token', body: { refreshToken: this.refreshToken } });
    let json = null;
    try {
      json = JSON.parse(answer.text);
    } catch {
      /* handled below */
    }
    if (answer.status === 200 && json?.data?.accessToken) {
      this.accessToken = json.data.accessToken;
      if (json.data.refreshToken) this.refreshToken = json.data.refreshToken;
      this.expiresAtMs = jwtExpiryMs(this.accessToken);
      this.lastRenewedAt = this.now();
      this.refreshes += 1;
      this.log(`session of ${this.name} renewed (${why})`);
      return true;
    }
    this.lost = `session of ${this.name} could not be renewed (HTTP ${answer.status} ${describeBody(answer.text)}); not signing in again to protect the sign-in budget`;
    return false;
  }
}
