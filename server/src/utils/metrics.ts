import crypto from 'crypto';
import type { Request, Response } from 'express';
import { log } from './logger';

/**
 * `GET /metrics` for monitoring (Prometheus text format). It does not exist until METRICS_TOKEN is set, and then it needs
 * `Authorization: Bearer <token>`. It exposes counts and states only: no names, e-mail addresses or ids.
 */
export interface MetricsSnapshot {
  uptimeSeconds: number;
  requests: Record<string, number>;
  databaseUp: boolean;
  redis: 'up' | 'down' | 'disabled';
  kafka: 'up' | 'down' | 'disabled';
  deadLetters: number | null;
  consumerLag: number | null;
  pendingRegistrations: number | null;
  overdueRegistrations: number | null;
}

const counts: Record<string, number> = {};

export const countRequest = (status: number) => {
  const key = `${Math.floor(status / 100)}xx`;
  counts[key] = (counts[key] ?? 0) + 1;
};
export const requestCounts = (): Record<string, number> => ({ ...counts });
export const resetRequestCounts = () => {
  for (const key of Object.keys(counts)) delete counts[key];
};

const gauge = (lines: string[], name: string, help: string, value: number | null | undefined, type: 'gauge' | 'counter' = 'gauge') => {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, `${name} ${Math.floor(value)}`);
};

export const renderMetrics = (s: MetricsSnapshot): string => {
  const lines: string[] = [];
  gauge(lines, 'aiem_up', 'The API answers.', 1);
  gauge(lines, 'aiem_process_uptime_seconds', 'Seconds since the API process started.', s.uptimeSeconds);
  lines.push('# HELP aiem_http_requests_total Responses sent, by status class.', '# TYPE aiem_http_requests_total counter');
  for (const [cls, n] of Object.entries(s.requests).sort()) lines.push(`aiem_http_requests_total{status_class="${cls}"} ${n}`);
  gauge(lines, 'aiem_database_up', '1 when PostgreSQL answers.', s.databaseUp ? 1 : 0);
  if (s.redis !== 'disabled') gauge(lines, 'aiem_redis_up', '1 when Redis is connected.', s.redis === 'up' ? 1 : 0);
  if (s.kafka !== 'disabled') gauge(lines, 'aiem_kafka_up', '1 when the Kafka producer is connected.', s.kafka === 'up' ? 1 : 0);
  gauge(lines, 'aiem_notification_dead_letters', 'Events waiting in the dead-letter topic.', s.deadLetters);
  gauge(lines, 'aiem_notification_consumer_lag', 'Notification events not yet processed by the consumer.', s.consumerLag);
  gauge(lines, 'aiem_registrations_pending', 'Registrations waiting for the administrator.', s.pendingRegistrations);
  gauge(lines, 'aiem_registrations_overdue', 'Registrations waiting 7 days or more.', s.overdueRegistrations);
  return `${lines.join('\n')}\n`;
};

/** Constant-time check of `Authorization: Bearer <token>`; false when no token is configured. */
export const tokenMatches = (header: string | undefined, token: string): boolean => {
  if (!token || !header || !header.startsWith('Bearer ')) return false;
  const given = crypto.createHash('sha256').update(header.slice(7)).digest();
  const wanted = crypto.createHash('sha256').update(token).digest();
  return header.length > 7 && crypto.timingSafeEqual(given, wanted);
};

export const createMetricsHandler = (deps: { token: () => string | undefined; snapshot: () => Promise<MetricsSnapshot> }) =>
  async (req: Request, res: Response) => {
    const token = deps.token();
    if (!token) return res.status(404).json({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } });
    if (!tokenMatches(req.headers.authorization, token)) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
    try {
      res.status(200).set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(renderMetrics(await deps.snapshot()));
    } catch (error) {
      log.error('Could not build the metrics', { err: error });
      res.status(500).json({ success: false, error: { message: 'Metrics are not available', code: 'INTERNAL_ERROR' } });
    }
  };
