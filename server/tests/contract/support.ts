/**
 * Shared helpers for the client/server contract suite: walks the real Express router (route order,
 * attached zod schemas) and matches concrete URLs the way Express does.
 */
import type { Router } from 'express';
import type { ZodTypeAny } from 'zod';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RegisteredRoute {
  method: HttpMethod;
  path: string;
  /** Position in the router stack: Express dispatches to the first match. */
  order: number;
  /** The zod schema passed to validate(), when the route has one. */
  schema?: ZodTypeAny;
  layer: { match: (path: string) => boolean };
}

export const routeKey = (method: string, path: string) => `${method.toLowerCase()} ${path}`;

/** Every route on the router, in registration order. Needs the validate() wrapper that records `.schema`. */
export const registeredRoutes = (router: Router): RegisteredRoute[] => {
  const routes: RegisteredRoute[] = [];
  (router as any).stack.forEach((layer: any, order: number) => {
    if (!layer.route) return;
    const schema = layer.route.stack.map((s: any) => s.handle?.schema).find(Boolean) as ZodTypeAny | undefined;
    for (const method of Object.keys(layer.route.methods)) {
      routes.push({ method: method as HttpMethod, path: layer.route.path, order, schema, layer });
    }
  });
  return routes;
};

/** Replace each `:param` with a stand-in value that no static segment equals. */
export const concretize = (path: string, value = 'PARAM_VALUE') => path.replace(/:[A-Za-z0-9_]+/g, value);

/** `/users/:id/follow` and `/users/:userId/follow` are the same route shape. */
export const shape = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, ':');

/** The route Express would dispatch `method path` to. */
export const dispatchTarget = (routes: RegisteredRoute[], method: string, concretePath: string) =>
  routes
    .filter((r) => r.method === method.toLowerCase())
    .sort((a, b) => a.order - b.order)
    .find((r) => r.layer.match(concretePath));

const typeNameOf = (schema: any): string | undefined => schema?._def?.typeName;

/** Peel effects/optional/nullable/default/pipeline wrappers to reach the underlying schema. */
export const unwrapSchema = (schema: ZodTypeAny): ZodTypeAny => {
  let current: any = schema;
  for (let i = 0; i < 20; i += 1) {
    const type = typeNameOf(current);
    if (type === 'ZodEffects') current = current._def.schema;
    else if (type === 'ZodOptional' || type === 'ZodNullable' || type === 'ZodDefault') current = current._def.innerType;
    else if (type === 'ZodPipeline') current = current._def.in;
    else break;
  }
  return current;
};

/** Keys the schema keeps from `section` ('body' | 'query' | 'params'); null when it does not define the section. */
export const schemaKeys = (schema: ZodTypeAny, section: 'body' | 'query' | 'params'): Set<string> | null => {
  const root: any = unwrapSchema(schema);
  if (typeNameOf(root) !== 'ZodObject') return null;
  const part = root.shape?.[section];
  if (!part) return null;
  const inner: any = unwrapSchema(part);
  if (typeNameOf(inner) !== 'ZodObject') return null;
  return new Set(Object.keys(inner.shape));
};
