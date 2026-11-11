// The live probe signs in and sends many requests. It belongs on a TEST stack (localhost, the Docker host on the tailnet,
// a CI service container), never on production. This guard refuses a public-looking host unless --allow-remote is given.
//
// Accepted without a flag: loopback, private IPv4 ranges (10/8, 172.16/12, 192.168/16, 169.254/16), Tailscale CGNAT
// (100.64/10), IPv6 loopback/unique-local/link-local, single-label names (a tailnet machine name such as atreya-2) and the
// suffixes .local .localhost .internal .lan .test .ts.net. Anything else, e.g. www.example.edu, needs --allow-remote.

export function isLikelyTestHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;

  // IPv4
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  // IPv6
  if (host.includes(':')) {
    return host === '::1' || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
  }
  // Names
  if (!host.includes('.')) return true; // single label: localhost, atreya-2, a compose service name
  return ['.local', '.localhost', '.internal', '.lan', '.test', '.ts.net'].some((suffix) => host.endsWith(suffix));
}
