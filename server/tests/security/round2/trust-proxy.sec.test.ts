/**
 * ROUND 2 - TRUST_PROXY must refuse every spelling of "trust any client-supplied address".
 * Round 1 refused the literals "true", "*", "0.0.0.0/0" and "::/0"; equivalent ranges slipped through.
 */
import { parseTrustProxy } from '../../../src/utils/trustProxy';

describe('R2-21 trust-everything ranges are refused however they are written', () => {
  it.each([
    '0.0.0.0/00',
    '0.0.0.0/000',
    '0.0.0.0/0',
    '1.2.3.4/0',
    '::/00',
    '::0/0',
    '0::/0',
    '0.0.0.0/1,128.0.0.0/1',
    '0.0.0.0/4',
    '10.0.0.0/99',
    '::1/129',
    '2000::/3',
    '::/1',
  ])('%j falls back to a single hop', (input) => {
    expect(parseTrustProxy(input)).toBe(1);
  });

  it.each([
    ['loopback', 'loopback'],
    ['10.0.0.0/8', '10.0.0.0/8'],
    ['172.16.0.0/12', '172.16.0.0/12'],
    ['192.168.0.0/16', '192.168.0.0/16'],
    ['127.0.0.1', '127.0.0.1'],
    ['::1', '::1'],
    ['fc00::/7', 'fc00::/7'],
    ['uniquelocal, loopback', ['uniquelocal', 'loopback']],
    ['3', 3],
  ])('%j is still understood', (input, expected) => {
    expect(parseTrustProxy(input)).toEqual(expected);
  });
});
