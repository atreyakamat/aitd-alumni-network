/**
 * Adapters from the API's people payloads to the shapes the directory, yearbook and network pages render.
 *
 * Server contract (server/tests/contract/response-shape.contract.test.ts):
 *  - GET /users/directory, /users/yearbook/:year: { id, fullName, profilePhotoUrl, batchYear, department,
 *    currentDesignation, city, ... }; the directory is `{ data: [...], pagination }`, the yearbook
 *    `{ data: { alumni: [...] } }`.
 *  - GET /network/connections: `{ data: [{ connectionId, connectedAt, id, fullName, ... }], pagination }`
 *    (the OTHER user, flattened, with the connection id alongside).
 *  - GET /network/requests: `{ data: { received: [{ connectionId, user, createdAt }], sent: [...] } }`.
 */
import { readPaginated } from '@/lib/api';

export interface PersonView {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  headline: string | null;
  department: string | null;
  batchYear: number | null;
  locationCity: string | null;
  locationCountry: string | null;
  skills: string[];
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** A user row from the directory, yearbook or network endpoints, in the shape the person cards render. */
export function toPerson(raw: any): PersonView {
  const skills = Array.isArray(raw?.skills)
    ? raw.skills
        .map((s: any) => (typeof s === 'string' ? s : s?.skill?.name ?? s?.name))
        .filter((s: unknown): s is string => typeof s === 'string')
    : [];
  return {
    id: String(raw?.id ?? ''),
    fullName: text(raw?.fullName) ?? 'Alumnus',
    avatarUrl: text(raw?.profilePhotoUrl) ?? text(raw?.avatarUrl),
    headline: text(raw?.currentDesignation) ?? text(raw?.headline),
    department: text(raw?.department),
    batchYear: typeof raw?.batchYear === 'number' ? raw.batchYear : null,
    locationCity: text(raw?.city) ?? text(raw?.locationCity),
    locationCountry: text(raw?.locationCountry),
    skills,
  };
}

export interface DirectoryPage {
  people: PersonView[];
  total: number;
  page: number;
  totalPages: number;
}

/** Response body of GET /users/directory. */
export function readDirectory(body: unknown): DirectoryPage {
  const { items, total, page, totalPages } = readPaginated<any>(body);
  return { people: items.map(toPerson), total, page, totalPages };
}

/** Response body of GET /users/yearbook/:year (`data.alumni`; a bare array is accepted too). */
export function readYearbook(body: any): PersonView[] {
  const data = body?.data;
  const list = Array.isArray(data?.alumni) ? data.alumni : Array.isArray(data) ? data : [];
  return list.map(toPerson);
}

export interface ConnectionEntry {
  /** Connection id (what DELETE /network/connection/:id takes). */
  id: string;
  partner: PersonView;
}

/** Response body of GET /network/connections. */
export function readConnections(body: unknown): ConnectionEntry[] {
  return readPaginated<any>(body).items.map((row) => ({ id: String(row.connectionId ?? row.id ?? ''), partner: toPerson(row) }));
}

export interface RequestEntry {
  /** Connection id (what POST /network/respond/:id takes). */
  id: string;
  person: PersonView;
  createdAt: string | null;
}

const requestEntries = (rows: unknown): RequestEntry[] =>
  (Array.isArray(rows) ? rows : []).map((row: any) => ({
    id: String(row?.connectionId ?? row?.id ?? ''),
    person: toPerson(row?.user ?? row?.requester),
    createdAt: text(row?.createdAt),
  }));

/** Response body of GET /network/requests: requests waiting on me and requests I sent. */
export function readRequests(body: any): { received: RequestEntry[]; sent: RequestEntry[] } {
  const data = body?.data;
  // A bare array is the pre-split shape: everything in it is addressed to the viewer
  if (Array.isArray(data)) return { received: requestEntries(data), sent: [] };
  return { received: requestEntries(data?.received), sent: requestEntries(data?.sent) };
}

/** Where a paged list stands: enough to show a total and to know whether "Load more" has anything to load. */
export interface PageInfo {
  total: number;
  page: number;
  hasNextPage: boolean;
}

const pageInfo = (raw: any): PageInfo | null =>
  raw && typeof raw === 'object'
    ? { total: Number(raw.total) || 0, page: Number(raw.page) || 1, hasNextPage: raw.hasNextPage === true }
    : null;

/**
 * Page info of GET /network/requests (`pagination: { received, sent }`). `null` for a list the server did not page
 * (the pre-pagination response, an error body, or the list that was not asked for).
 */
export function readRequestsPaging(body: any): { received: PageInfo | null; sent: PageInfo | null } {
  return { received: pageInfo(body?.pagination?.received), sent: pageInfo(body?.pagination?.sent) };
}

/** `Class of 2018 • Computer Engineering`, skipping whatever is unknown. */
export function batchLine(person: Pick<PersonView, 'batchYear' | 'department'>): string {
  return [person.batchYear ? `Class of ${person.batchYear}` : null, person.department].filter(Boolean).join(' • ');
}
