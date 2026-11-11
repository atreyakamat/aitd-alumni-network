/**
 * `GET /api/admin/system-status` read defensively, for the administrators' System status page: a service with an
 * unknown state is shown as "needs attention" rather than as working, and a missing overall state is worked out from the
 * services (the worst one wins).
 */
import type { SystemServiceState, SystemServiceStatus, SystemStatus } from '@/lib/api';

type Overall = SystemStatus['overall'];

const SERVICE_STATES: readonly string[] = ['ok', 'warning', 'error', 'off'];
const OVERALL_STATES: readonly string[] = ['ok', 'warning', 'error'];

const isDict = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The worst state among the services ("off" does not count: a service that is not used cannot be a problem). */
export function deriveOverall(services: Array<{ status: SystemServiceState }>): Overall {
  if (services.some((s) => s.status === 'error')) return 'error';
  if (services.some((s) => s.status === 'warning')) return 'warning';
  return 'ok';
}

export function normalizeSystemStatus(raw: unknown): SystemStatus {
  const root = isDict(raw) ? raw : {};
  const services: SystemServiceStatus[] = (Array.isArray(root.services) ? root.services : [])
    .filter(isDict)
    .map((s, index) => ({
      key: typeof s.key === 'string' && s.key ? s.key : `service-${index}`,
      label: typeof s.label === 'string' && s.label ? s.label : typeof s.key === 'string' ? s.key : 'Service',
      status: (typeof s.status === 'string' && SERVICE_STATES.includes(s.status) ? s.status : 'warning') as SystemServiceState,
      detail: typeof s.detail === 'string' ? s.detail : '',
    }));

  return {
    checkedAt: typeof root.checkedAt === 'string' ? root.checkedAt : '',
    environment: typeof root.environment === 'string' ? root.environment : '',
    version: typeof root.version === 'string' ? root.version : '',
    uptimeSeconds: typeof root.uptimeSeconds === 'number' && Number.isFinite(root.uptimeSeconds) ? root.uptimeSeconds : 0,
    overall: (typeof root.overall === 'string' && OVERALL_STATES.includes(root.overall) ? root.overall : deriveOverall(services)) as Overall,
    services,
  };
}
