import { renderMetrics, tokenMatches, createMetricsHandler, countRequest, requestCounts, resetRequestCounts, type MetricsSnapshot } from '../../utils/metrics';

const snapshot = (over: Partial<MetricsSnapshot> = {}): MetricsSnapshot => ({
  uptimeSeconds: 120.7,
  requests: { '2xx': 10, '4xx': 2, '5xx': 1 },
  databaseUp: true,
  redis: 'up',
  kafka: 'up',
  deadLetters: 0,
  consumerLag: 3,
  pendingRegistrations: 4,
  overdueRegistrations: 1,
  ...over,
});

describe('renderMetrics', () => {
  it('writes the Prometheus text format with HELP and TYPE lines', () => {
    const text = renderMetrics(snapshot());
    expect(text).toContain('# HELP aiem_up');
    expect(text).toContain('# TYPE aiem_http_requests_total counter');
    expect(text).toContain('aiem_http_requests_total{status_class="2xx"} 10');
    expect(text).toContain('aiem_http_requests_total{status_class="5xx"} 1');
    expect(text).toContain('aiem_process_uptime_seconds 120');
    expect(text).toContain('aiem_database_up 1');
    expect(text).toContain('aiem_notification_dead_letters 0');
    expect(text).toContain('aiem_notification_consumer_lag 3');
    expect(text).toContain('aiem_registrations_pending 4');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('says 0 for a service that is down, leaves out what is not in use, and never prints a null', () => {
    const text = renderMetrics(snapshot({ databaseUp: false, redis: 'disabled', kafka: 'down', deadLetters: null, consumerLag: null }));
    expect(text).toContain('aiem_database_up 0');
    expect(text).not.toContain('aiem_redis_up');
    expect(text).toContain('aiem_kafka_up 0');
    expect(text).not.toContain('aiem_notification_dead_letters');
    expect(text).not.toMatch(/null|undefined|NaN/);
  });
});

describe('tokenMatches', () => {
  it('accepts exactly the configured bearer token, nothing else', () => {
    expect(tokenMatches('Bearer s3cret-token', 's3cret-token')).toBe(true);
    expect(tokenMatches('Bearer wrong-token!', 's3cret-token')).toBe(false);
    expect(tokenMatches('s3cret-token', 's3cret-token')).toBe(false);
    expect(tokenMatches(undefined, 's3cret-token')).toBe(false);
    expect(tokenMatches('Bearer ', 's3cret-token')).toBe(false);
    expect(tokenMatches('Bearer anything', '')).toBe(false);
  });
});

describe('createMetricsHandler', () => {
  const run = async (handler: ReturnType<typeof createMetricsHandler>, authorization?: string) => {
    const res: any = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn() };
    await handler({ headers: { authorization } } as any, res);
    return res;
  };

  it('does not exist (404) until a token is configured', async () => {
    const res = await run(createMetricsHandler({ token: () => undefined, snapshot: async () => snapshot() }), 'Bearer x');
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('refuses a missing or wrong token with 401 and never builds the snapshot', async () => {
    const build = jest.fn(async () => snapshot());
    const handler = createMetricsHandler({ token: () => 'a-long-secret-token', snapshot: build });
    expect((await run(handler)).status).toHaveBeenCalledWith(401);
    expect((await run(handler, 'Bearer nope')).status).toHaveBeenCalledWith(401);
    expect(build).not.toHaveBeenCalled();
  });

  it('answers text/plain with the metrics for the right token, and keeps a failing probe from breaking the scrape', async () => {
    const handler = createMetricsHandler({ token: () => 'a-long-secret-token', snapshot: async () => snapshot() });
    const res = await run(handler, 'Bearer a-long-secret-token');
    expect(res.set).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/plain'));
    expect(res.send.mock.calls[0][0]).toContain('aiem_up 1');
    const broken = createMetricsHandler({ token: () => 'a-long-secret-token', snapshot: async () => { throw new Error('db down'); } });
    const bad = await run(broken, 'Bearer a-long-secret-token');
    expect(bad.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(bad.send.mock.calls) + JSON.stringify(bad.json.mock.calls)).not.toContain('db down');
  });
});

describe('request counter', () => {
  it('counts responses by status class', () => {
    resetRequestCounts();
    countRequest(200); countRequest(204); countRequest(404); countRequest(503); countRequest(302);
    expect(requestCounts()).toEqual({ '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 1 });
  });
});
