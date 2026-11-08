/**
 * Express `trust proxy` setting from the TRUST_PROXY environment variable.
 *
 * Rate limits (and audit logs) key on the client IP. Behind a reverse proxy that IP comes from
 * X-Forwarded-For, but that header is plain text a client can set itself: trusting it when NO proxy
 * is in front lets anyone dodge every per-IP limit by rotating the header. So the number of trusted
 * hops must match the real deployment:
 *
 *   TRUST_PROXY=1          one proxy in front (nginx, a load balancer, Caddy)      <- default
 *   TRUST_PROXY=2          e.g. Cloudflare + nginx
 *   TRUST_PROXY=0 / false  API reachable directly: ignore X-Forwarded-For
 *   TRUST_PROXY=loopback   or a comma-separated list of proxy IPs / CIDR ranges
 *
 * "true", "*" and other values that would trust any client-supplied address are refused.
 */
import { isIP } from 'net';

const MAX_HOPS = 10;
const MIN_IPV4_PREFIX = 8;
const MIN_IPV6_PREFIX = 7;

export const parseTrustProxy = (raw: string | undefined): number | boolean | string | string[] => {
  const value = (raw ?? '').trim();
  if (!value) return 1;

  const lower = value.toLowerCase();
  if (lower === 'false' || lower === 'off' || lower === 'no') return false;
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops === 0) return false;
    return hops <= MAX_HOPS ? hops : 1;
  }

  // Express subnet keywords / addresses (loopback, linklocal, uniquelocal, 10.0.0.0/8, ::1 ...)
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const looksLikeAddress = (entry: string) => {
    if (/^(loopback|linklocal|uniquelocal)$/i.test(entry)) return true;
    const [address, prefix, ...rest] = entry.split('/');
    const family = isIP(address);
    if (rest.length > 0 || family === 0) return false;
    if (prefix === undefined) return true;
    if (!/^\d{1,3}$/.test(prefix)) return false;
    // "0.0.0.0/00", "::0/0" or "0.0.0.0/1,128.0.0.0/1" all mean "any client": a range must be a real network (the
    // private ranges are /8, /12, /16 and fc00::/7), so anything broader is refused like "*".
    const bits = Number(prefix);
    return family === 4 ? bits >= MIN_IPV4_PREFIX && bits <= 32 : bits >= MIN_IPV6_PREFIX && bits <= 128;
  };
  if (entries.length > 0 && entries.every((entry) => entry !== '*' && entry !== '0.0.0.0/0' && entry !== '::/0' && looksLikeAddress(entry))) {
    return entries.length === 1 ? entries[0] : entries;
  }

  // Anything else (true, *, negative, fractional, junk): keep the safe default of a single hop
  return 1;
};
