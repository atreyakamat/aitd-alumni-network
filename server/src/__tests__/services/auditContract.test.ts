import fs from 'fs';
import path from 'path';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../../services/auditService';

const CLIENT_API = path.resolve(__dirname, '../../../../client/src/lib/api.ts');

/** Read a `export const NAME = [ 'A', 'B', ... ]` string list from the client API module. */
const clientList = (name: string): string[] => {
  const source = fs.readFileSync(CLIENT_API, 'utf8');
  const match = source.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`${name} not found in client/src/lib/api.ts`);
  return [...match[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
};

describe('audit log contract (server ↔ client admin audit page)', () => {
  it('client offers exactly the server audit actions as filters', () => {
    expect([...clientList('AUDIT_ACTIONS')].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it('client offers exactly the server audit entity types as filters', () => {
    expect([...clientList('AUDIT_ENTITY_TYPES')].sort()).toEqual([...AUDIT_ENTITY_TYPES].sort());
  });
});
