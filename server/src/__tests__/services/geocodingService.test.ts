import { GeocodingService } from '../../services/geocodingService';

const nominatimPlace = (overrides: Record<string, unknown> = {}) => ({
  display_name: 'Pune, Maharashtra, India',
  lat: '18.5213738',
  lon: '73.8545071',
  address: { city: 'Pune', state: 'Maharashtra', country: 'India' },
  ...overrides,
});

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

const makeService = (overrides: Partial<ConstructorParameters<typeof GeocodingService>[0]> = {}) => {
  const fetchMock = jest.fn();
  const service = new GeocodingService({
    baseUrl: 'https://geo.example.test',
    userAgent: 'AITD-Test/1.0',
    email: '',
    minIntervalMs: 0,
    timeoutMs: 1000,
    cacheTtlMs: 60_000,
    cacheMaxEntries: 3,
    fetch: fetchMock as unknown as typeof fetch,
    ...overrides,
  });
  return { service, fetchMock };
};

describe('GeocodingService.search', () => {
  it('maps Nominatim results to { label, lat, lng, city }', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse([nominatimPlace()]));

    await expect(service.search('Pune')).resolves.toEqual([
      { label: 'Pune, Maharashtra, India', lat: 18.5213738, lng: 73.8545071, city: 'Pune' },
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://geo.example.test/search');
    expect(parsed.searchParams.get('q')).toBe('Pune');
    expect(parsed.searchParams.get('format')).toBe('jsonv2');
    expect(parsed.searchParams.get('limit')).toBe('5');
    // Nominatim's usage policy requires an identifying User-Agent
    expect(init.headers['User-Agent']).toBe('AITD-Test/1.0');
  });

  it('falls back through town / village / county for the city name', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(
      jsonResponse([
        nominatimPlace({ address: { town: 'Lonavala' } }),
        nominatimPlace({ address: { village: 'Karla' } }),
        nominatimPlace({ address: { county: 'Mulshi' } }),
        nominatimPlace({ address: {} }),
      ])
    );

    const cities = (await service.search('x')).map((r) => r.city);
    expect(cities).toEqual(['Lonavala', 'Karla', 'Mulshi', null]);
  });

  it('drops results with unusable coordinates', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse([nominatimPlace({ lat: 'nope' }), nominatimPlace({ lon: '500' })]));
    await expect(service.search('x')).resolves.toEqual([]);
  });

  it('clamps the limit and passes the contact email when configured', async () => {
    const { service, fetchMock } = makeService({ email: 'ops@aitd.test' });
    fetchMock.mockResolvedValue(jsonResponse([]));

    await service.search('Mumbai', 50);
    const parsed = new URL(fetchMock.mock.calls[0][0]);
    expect(parsed.searchParams.get('limit')).toBe('10');
    expect(parsed.searchParams.get('email')).toBe('ops@aitd.test');
  });

  it('rejects blank or oversized queries with 400', async () => {
    const { service, fetchMock } = makeService();
    await expect(service.search('  ')).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.search('x'.repeat(201))).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serves repeated queries from cache (case/whitespace-insensitive)', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse([nominatimPlace()]));

    await service.search('Pune');
    await service.search('  pune ');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('expires cache entries after the TTL', async () => {
    let now = 1_000;
    const { service, fetchMock } = makeService({ cacheTtlMs: 100, now: () => now });
    fetchMock.mockResolvedValue(jsonResponse([]));

    await service.search('Pune');
    now += 101;
    await service.search('Pune');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const { service, fetchMock } = makeService({ cacheMaxEntries: 2 });
    fetchMock.mockResolvedValue(jsonResponse([]));

    await service.search('a');
    await service.search('b');
    await service.search('c'); // evicts "a"
    await service.search('a');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('turns upstream failures into 503 GEOCODER_UNAVAILABLE and does not cache them', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'busy' }, 429));
    await expect(service.search('Pune')).rejects.toMatchObject({ statusCode: 503, code: 'GEOCODER_UNAVAILABLE' });

    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(service.search('Pune')).rejects.toMatchObject({ statusCode: 503, code: 'GEOCODER_UNAVAILABLE' });

    fetchMock.mockResolvedValueOnce(jsonResponse([nominatimPlace()]));
    await expect(service.search('Pune')).resolves.toHaveLength(1);
  });

  it('returns 503 without calling out when the geocoder is disabled', async () => {
    const { service, fetchMock } = makeService({ baseUrl: '' });
    expect(service.enabled).toBe(false);
    await expect(service.search('Pune')).rejects.toMatchObject({ statusCode: 503, code: 'GEOCODER_UNAVAILABLE' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts slow upstream calls after the timeout', async () => {
    jest.useFakeTimers();
    try {
      const { service, fetchMock } = makeService({ timeoutMs: 50 });
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          })
      );

      const pending = expect(service.search('Pune')).rejects.toMatchObject({ statusCode: 503 });
      await jest.advanceTimersByTimeAsync(60);
      await pending;
    } finally {
      jest.useRealTimers();
    }
  });

  it('spaces upstream calls by the minimum interval (Nominatim allows 1 request/second)', async () => {
    let now = 0;
    const sleeps: number[] = [];
    const { service, fetchMock } = makeService({
      minIntervalMs: 1000,
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
    });
    fetchMock.mockResolvedValue(jsonResponse([]));

    await service.search('a');
    now += 200;
    await service.search('b');
    expect(sleeps).toEqual([800]);
  });
});

describe('GeocodingService.reverse', () => {
  it('maps a reverse lookup to { label, city, lat, lng }', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse(nominatimPlace()));

    await expect(service.reverse(18.52, 73.85)).resolves.toEqual({
      label: 'Pune, Maharashtra, India',
      city: 'Pune',
      lat: 18.5213738,
      lng: 73.8545071,
    });

    const parsed = new URL(fetchMock.mock.calls[0][0]);
    expect(parsed.pathname).toBe('/reverse');
    expect(parsed.searchParams.get('lat')).toBe('18.52');
    expect(parsed.searchParams.get('lon')).toBe('73.85');
  });

  it('returns null when nothing is there (open ocean)', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse({ error: 'Unable to geocode' }));
    await expect(service.reverse(0, -30)).resolves.toBeNull();
  });

  it('caches by rounded coordinates so jittery GPS fixes reuse one lookup', async () => {
    const { service, fetchMock } = makeService();
    fetchMock.mockResolvedValue(jsonResponse(nominatimPlace()));

    await service.reverse(18.52131, 73.85451);
    await service.reverse(18.52139, 73.85449);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects out-of-range coordinates with 400', async () => {
    const { service } = makeService();
    await expect(service.reverse(91, 0)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.reverse(0, -181)).rejects.toMatchObject({ statusCode: 400 });
    await expect(service.reverse(Number.NaN, 0)).rejects.toMatchObject({ statusCode: 400 });
  });
});
