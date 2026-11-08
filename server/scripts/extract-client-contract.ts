/**
 * Builds tests/contract/inventory.json: every HTTP call the Next.js client makes, parsed from its
 * TypeScript source with the compiler API (no regexes over formatted text).
 *
 * Per call it records the HTTP method, the path template (`${id}` -> `:id`), the body fields (for
 * post/put/patch/delete) or query fields (for get/delete) the client can send, resolved from the type
 * of the argument, plus where the call lives and how the response is consumed.
 *
 * Regenerate with `npm run contract:inventory` (from server/). tests/contract/client-contract.contract.test.ts
 * re-runs the extraction and fails when the committed inventory.json is stale.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export interface InventoryField {
  name: string;
  optional: boolean;
}

export interface InventoryCall {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Path relative to the API base, params as `:name`. */
  path: string;
  /** File the call is made in, relative to the repo root. */
  source: string;
  /** 1-based line of the call (informational: the freshness check ignores it so unrelated edits do not fail it). */
  line: number;
  /** Nearest named owner, e.g. `jobApi.createJob`. */
  caller: string;
  /** Request body fields (post/put/patch and delete with `data`). `null` when not statically known. */
  body: InventoryField[] | null;
  /** True when the body is multipart/form-data (fields are not enumerated). */
  multipart: boolean;
  /** Query-string fields. */
  query: InventoryField[] | null;
  /** Declared response type argument (`api.get<ApiPaginated<X>>`), if any. */
  responseType: string | null;
  /** Wrapper calls that consume the response, outermost first (e.g. `normalizePage`, `data`). */
  consumers: string[];
}

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const CLIENT_ROOT = path.resolve(__dirname, '../../client');
const OUT_FILE = path.resolve(__dirname, '../tests/contract/inventory.json');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === '__security__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
};

const lastIdentifier = (node: ts.Expression): string => {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return lastIdentifier(node.expression);
  if (ts.isCallExpression(node) && node.arguments.length > 0) return lastIdentifier(node.arguments[0]);
  if (ts.isAsExpression(node)) return lastIdentifier(node.expression);
  return 'param';
};

/** `/users/${seg(userId)}/follow` -> `/users/:userId/follow`; a leading `${currentApiUrl}` is the API base. */
const pathOf = (node: ts.Expression | undefined): string | null => {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    node.templateSpans.forEach((span, index) => {
      const isBase = index === 0 && text === '' && /apiBase|api_?url/i.test(span.expression.getText());
      text += isBase ? '' : `:${lastIdentifier(span.expression)}`;
      text += span.literal.text;
    });
    return text;
  }
  return null;
};

const unwrap = (node: ts.Expression): ts.Expression => {
  let current = node;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current) || ts.isAsExpression(current)) {
      current = current.expression;
    } else if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && current.expression.text === 'cleanParams') {
      current = current.arguments[0];
    } else {
      return current;
    }
  }
};

const propName = (name: ts.PropertyName): string | null =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;

const objectProp = (obj: ts.Expression | undefined, key: string): ts.Expression | undefined => {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return undefined;
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && propName(prop.name) === key) return prop.initializer;
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === key) return prop.name;
  }
  return undefined;
};

const fieldsOfType = (checker: ts.TypeChecker, type: ts.Type, at: ts.Node): InventoryField[] | null => {
  const seen = new Map<string, boolean>();
  const visit = (t: ts.Type) => {
    if (t.isUnion()) {
      t.types.forEach(visit);
      return;
    }
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return;
    for (const symbol of checker.getPropertiesOfType(t)) {
      const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      // A field present on only some union members is optional overall
      seen.set(symbol.name, (seen.get(symbol.name) ?? false) || optional);
    }
  };
  const resolved = checker.getTypeAtLocation(at);
  if (resolved.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  visit(type);
  return [...seen.entries()].map(([name, optional]) => ({ name, optional })).sort((a, b) => a.name.localeCompare(b.name));
};

const typeText = (checker: ts.TypeChecker, node: ts.TypeNode): string => node.getText().replace(/\s+/g, ' ');

const callerOf = (node: ts.Node): string => {
  const names: string[] = [];
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isPropertyAssignment(current)) {
      const name = propName(current.name);
      if (name) names.unshift(name);
    } else if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      names.unshift(current.name.text);
      break;
    } else if (ts.isFunctionDeclaration(current) && current.name) {
      names.unshift(current.name.text);
      break;
    } else if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      names.unshift(current.name.text);
    }
  }
  return names.join('.') || '(anonymous)';
};

const consumersOf = (call: ts.CallExpression): string[] => {
  const out: string[] = [];
  let current: ts.Node = call;
  while (current.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
      current = parent;
      continue;
    }
    if (ts.isCallExpression(parent) && parent.arguments.some((a) => a === current)) {
      out.unshift(parent.expression.getText());
      // Normalisers passed as extra arguments, e.g. normalizePage(x, normalizePost)
      for (const arg of parent.arguments) if (ts.isIdentifier(arg) && arg !== current) out.push(arg.text);
      current = parent;
      continue;
    }
    break;
  }
  return out;
};

export const extractInventory = (): InventoryCall[] => {
  const tsconfigPath = path.join(CLIENT_ROOT, 'tsconfig.json');
  const parsed = ts.parseJsonConfigFileContent(ts.readConfigFile(tsconfigPath, ts.sys.readFile).config, ts.sys, CLIENT_ROOT);
  const callPattern = /\b(?:api|axios)\.(?:get|post|put|patch|delete)\b|\bfetch\(/;
  const roots = walk(path.join(CLIENT_ROOT, 'src')).filter((file) => callPattern.test(fs.readFileSync(file, 'utf8')));
  const program = ts.createProgram(roots, { ...parsed.options, noEmit: true, incremental: false, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const calls: InventoryCall[] = [];

  for (const file of roots) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        METHODS.has(node.expression.name.text) &&
        ts.isIdentifier(node.expression.expression) &&
        (node.expression.expression.text === 'api' || node.expression.expression.text === 'axios')
      ) {
        const method = node.expression.name.text as InventoryCall['method'];
        const url = pathOf(node.arguments[0]);
        if (url !== null) {
          const second = node.arguments[1] ? unwrap(node.arguments[1]) : undefined;
          const hasBody = method === 'post' || method === 'put' || method === 'patch';
          let body: InventoryField[] | null = null;
          let multipart = false;
          let query: InventoryField[] | null = null;

          if (hasBody && second) {
            const type = checker.getTypeAtLocation(second);
            if (type.symbol?.name === 'FormData') multipart = true;
            else body = fieldsOfType(checker, type, second);
            query = null;
            const config = node.arguments[2];
            const params = objectProp(config, 'params');
            if (params) query = fieldsOfType(checker, checker.getTypeAtLocation(unwrap(params)), unwrap(params));
          } else if (!hasBody) {
            const params = objectProp(second, 'params');
            if (params) query = fieldsOfType(checker, checker.getTypeAtLocation(unwrap(params)), unwrap(params));
            const data = objectProp(second, 'data');
            if (data) body = fieldsOfType(checker, checker.getTypeAtLocation(unwrap(data)), unwrap(data));
          }

          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          calls.push({
            method,
            path: url.startsWith('/') ? url : `/${url}`,
            source: path.relative(path.resolve(CLIENT_ROOT, '..'), file).split(path.sep).join('/'),
            line: line + 1,
            caller: callerOf(node),
            body,
            multipart,
            query,
            responseType: node.typeArguments?.[0] ? typeText(checker, node.typeArguments[0]) : null,
            consumers: consumersOf(node),
          });
        }
      }
      // Server components call the API with fetch(`${apiBase()}/events/${id}`, { ... })
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch') {
        const url = pathOf(node.arguments[0]);
        if (url && url.startsWith('/') && !url.startsWith('//')) {
          const methodInit = objectProp(node.arguments[1], 'method');
          const method = (methodInit && ts.isStringLiteralLike(methodInit) ? methodInit.text.toLowerCase() : 'get') as InventoryCall['method'];
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          calls.push({
            method,
            path: url,
            source: path.relative(path.resolve(CLIENT_ROOT, '..'), file).split(path.sep).join('/'),
            line: line + 1,
            caller: callerOf(node),
            body: null,
            multipart: false,
            query: null,
            responseType: null,
            consumers: [],
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  return calls.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.source.localeCompare(b.source)
  );
};

export const serializeInventory = (calls: InventoryCall[], withLines = true): string =>
  `${JSON.stringify(withLines ? calls : calls.map((call) => ({ ...call, line: undefined })), null, 2)}
`;
export const INVENTORY_FILE = OUT_FILE;

if (require.main === module) {
  const calls = extractInventory();
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, serializeInventory(calls));
  console.log(`Wrote ${calls.length} client calls to ${path.relative(process.cwd(), OUT_FILE)}`);
}
