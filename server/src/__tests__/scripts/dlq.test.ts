import { parseArgs } from '../../scripts/dlq';

describe('dlq command line', () => {
  it('needs a known command', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(() => parseArgs(['explode'])).toThrow(/Usage/);
  });

  it('is read-only by default: replay and purge need --yes', () => {
    expect(parseArgs(['replay', '--all']).yes).toBe(false);
    expect(parseArgs(['purge']).yes).toBe(false);
    expect(parseArgs(['purge', '--yes']).yes).toBe(true);
  });

  it('parses limits, offsets and flags and rejects nonsense', () => {
    expect(parseArgs(['list', '--limit', '5', '--json'])).toMatchObject({ command: 'list', limit: 5, json: true });
    expect(parseArgs(['replay', '--offset', '0:3', '--offset', '0:4']).offsets).toEqual(['0:3', '0:4']);
    expect(() => parseArgs(['list', '--limit', '0'])).toThrow(/whole number/);
    expect(() => parseArgs(['list', '--limit'])).toThrow(/whole number/);
    expect(() => parseArgs(['replay', '--offset'])).toThrow(/partition:offset/);
    expect(() => parseArgs(['list', '--wat'])).toThrow(/Unknown option/);
  });
});
