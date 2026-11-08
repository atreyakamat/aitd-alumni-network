/**
 * Static contract between the Next.js client and the Express API.
 *
 * The client's HTTP calls are extracted from its TypeScript source (scripts/extract-client-contract.ts,
 * committed as tests/contract/inventory.json) and checked against the live router:
 *   1. every call hits a route that exists, with the same method;
 *   2. no earlier route (a `/:id` registered before `/nearby`) swallows the request;
 *   3. no route is dead because an earlier one always wins;
 *   4. every body field the client sends survives the route's zod schema (z.object STRIPS unknown keys,
 *      so a field missing from the schema is silently dropped: the createPostSchema bug class).
 *
 * Regenerate the inventory with `npm run contract:inventory`.
 */
import fs from 'fs';
import path from 'path';

// Record the schema each validate() call was given so the suite can introspect it
jest.mock('../../src/middleware/validate', () => {
  const actual = jest.requireActual('../../src/middleware/validate');
  return {
    ...actual,
    validate: (schema: unknown) => {
      const handler = actual.validate(schema);
      (handler as unknown as { schema: unknown }).schema = schema;
      return handler;
    },
  };
});

import router from '../../src/routes';
import { extractInventory, serializeInventory, INVENTORY_FILE, type InventoryCall } from '../../scripts/extract-client-contract';
import { concretize, dispatchTarget, registeredRoutes, routeKey, schemaKeys, shape } from './support';

const clientAvailable = fs.existsSync(path.resolve(__dirname, '../../../client/src'));
const describeWithClient = clientAvailable ? describe : describe.skip;

const routes = registeredRoutes(router);
let inventory: InventoryCall[] = [];

beforeAll(() => {
  if (clientAvailable) inventory = extractInventory();
}, 120000);

describe('router', () => {
  it('lists the routes it will be checked against', () => {
    expect(routes.length).toBeGreaterThan(150);
  });

  it('has no dead route: each route is the first match for its own path', () => {
    const dead = routes
      .filter((route) => dispatchTarget(routes, route.method, concretize(route.path))?.order !== route.order)
      .map((route) => {
        const winner = dispatchTarget(routes, route.method, concretize(route.path));
        return `${routeKey(route.method, route.path)} is shadowed by ${winner ? routeKey(winner.method, winner.path) : '(nothing)'}`;
      });
    expect(dead).toEqual([]);
  });
});

describeWithClient('client calls vs router', () => {
  it('extracts a plausible number of client calls', () => {
    expect(inventory.length).toBeGreaterThan(150);
  });

  it('the committed inventory.json is current (run `npm run contract:inventory`)', () => {
    const committed = JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8')) as InventoryCall[];
    // Line numbers move with every unrelated edit; everything else must match
    expect(serializeInventory(committed, false)).toBe(serializeInventory(inventory, false));
  });

  it('every client call targets a registered route with the same method', () => {
    const missing = inventory
      .filter((call) => !routes.some((r) => r.method === call.method && shape(r.path) === shape(call.path)))
      .map((call) => `${call.method.toUpperCase()} ${call.path}  (${call.source}:${call.line})`);
    expect(missing).toEqual([]);
  });

  it('every client call is dispatched to the intended route, not an earlier look-alike', () => {
    const shadowed = inventory
      .map((call) => ({ call, target: dispatchTarget(routes, call.method, concretize(call.path)) }))
      .filter(({ call, target }) => target && shape(target.path) !== shape(call.path))
      .map(
        ({ call, target }) => `${call.method.toUpperCase()} ${call.path} -> ${routeKey(target!.method, target!.path)}  (${call.source}:${call.line})`
      );
    expect(shadowed).toEqual([]);
  });

  it('every body field the client sends is kept by the route schema (zod strips unknown keys)', () => {
    const dropped: string[] = [];
    for (const call of inventory) {
      if (!call.body || call.body.length === 0) continue;
      const route = routes.find((r) => r.method === call.method && shape(r.path) === shape(call.path));
      if (!route?.schema) continue;
      const accepted = schemaKeys(route.schema, 'body');
      if (!accepted) continue;
      for (const field of call.body) {
        if (!accepted.has(field.name)) {
          dropped.push(
            `${call.method.toUpperCase()} ${call.path}: '${field.name}' is sent by ${call.caller} (${call.source}:${call.line}) but not in the schema`
          );
        }
      }
    }
    expect(dropped).toEqual([]);
  });
});
