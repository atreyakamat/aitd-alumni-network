import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setSleepScale } from '../lib/http.mjs';
import { buildGates, runGates } from '../gates.mjs';
import { createWorld, makeCtx } from './fake-world.mjs';

setSleepScale(0.0005);

const SECRET = 'secret-jwt-value-1234567890';

const play = async ({ bugs = {}, ctxOptions = {}, worldOptions = {} } = {}) => {
  const world = createWorld({ bugs, secrets: [SECRET], ...worldOptions });
  const ctx = makeCtx(world, ctxOptions);
  await runGates(ctx, buildGates());
  const byId = Object.fromEntries(ctx.report.gates.map((gate) => [gate.id, gate]));
  const failed = ctx.report.gates.filter((gate) => gate.status === 'fail').map((gate) => gate.id);
  return { world, ctx, byId, failed };
};

describe('a healthy stack', () => {
  test('passes every gate, drills included, and nothing is skipped', async () => {
    const { ctx, failed } = await play();
    const details = ctx.report.gates.filter((g) => g.status !== 'pass').map((g) => `${g.id} ${g.status}: ${g.detail}`);
    assert.deepEqual(details, []);
    assert.equal(failed.length, 0);
    assert.equal(ctx.report.gates.length, buildGates().length);
  });

  test('--skip-drills skips only the drills', async () => {
    const { ctx, failed } = await play({ ctxOptions: { skipDrills: true } });
    assert.deepEqual(failed, []);
    const skipped = ctx.report.gates.filter((g) => g.status === 'skip').map((g) => g.id);
    assert.deepEqual(skipped, ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09']);
  });

  test('without Docker (attach mode) the stack, Kafka and drill gates are skipped and the HTTP gates still pass', async () => {
    const { ctx, failed } = await play({ ctxOptions: { stack: false, mail: false, verification: false }, worldOptions: { verification: false } });
    assert.deepEqual(failed, []);
    const passed = ctx.report.gates.filter((g) => g.status === 'pass').map((g) => g.id);
    for (const id of ['A01', 'A02', 'A03', 'A04', 'A05', 'F01', 'F02', 'F03', 'F04', 'X02']) assert.ok(passed.includes(id), `${id} should pass in attach mode`);
    for (const id of ['S02', 'K01', 'D01', 'X01']) assert.equal(ctx.report.gates.find((g) => g.id === id).status, 'skip');
  });

  test('the drills leave the stack the way they found it (everything running)', async () => {
    const { world } = await play();
    assert.equal(world.s.apiUp && world.s.kafkaUp && world.s.redisUp, true);
    assert.equal(world.s.stopped.size, 0);
  });
});

describe('every gate can actually fail: a planted defect is caught by the gate that owns it', () => {
  const cases = [
    ['leakSecret', 'X01', 'a secret value in the container logs'],
    ['openPostgres', 'S05', 'PostgreSQL published on every interface'],
    ['publishedKafka', 'S05', 'Kafka published to the network'],
    ['rootUser', 'S04', 'a container running as root'],
    ['crashLoop', 'S03', 'a container that keeps restarting'],
    ['noDlq', 'D03', 'poison messages silently dropped'],
    ['noIdempotency', 'D04', 'a duplicate event delivered twice'],
    ['statusStuckUp', 'D01', '/health claiming Kafka is up while the broker is stopped'],
    ['staleNotices', 'F03', 'review notices left unread after the decision'],
    ['noLimiter', 'X02', 'no rate limiting'],
    ['badRestore', 'D08', 'a restore that is missing data'],
    ['restoreFails', 'D08', 'a dump that cannot be restored'],
    ['wrongPartitions', 'K01', 'the wrong partition count'],
  ];
  for (const [bug, gateId, why] of cases) {
    test(`${why} -> ${gateId} fails`, async () => {
      const { failed, byId } = await play({ bugs: { [bug]: true } });
      assert.ok(failed.includes(gateId), `${gateId} should fail; failed: ${failed.join(',') || 'none'}`);
      assert.ok(byId[gateId].detail.length > 10, 'the failure explains itself');
    });
  }

  test('a consumer that never catches up fails the lag gates', async () => {
    const { failed } = await play({ bugs: { stuckLag: true } });
    assert.ok(failed.includes('K03'));
    assert.ok(failed.includes('D02'));
  });

  test('a stack that cannot start fails S02 and skips everything that needs it, with the reason', async () => {
    const { byId, failed, ctx } = await play({ bugs: { upFails: true } });
    assert.equal(byId.S02.status, 'fail');
    assert.match(byId.S02.detail, /failed to build/);
    assert.ok(failed.every((id) => id === 'S02' || id.startsWith('P')), `unexpected failures: ${failed.join(',')}`);
    assert.equal(byId.A01.status, 'skip');
    assert.match(byId.A01.detail, /did not start/);
    assert.ok(ctx.lines.some((line) => line.startsWith('FAIL  S02')));
  });
});

describe('the evidence', () => {
  test('never contains a secret, even when a gate quotes a log that leaked it', async () => {
    const { ctx } = await play({ bugs: { leakSecret: true } });
    const text = JSON.stringify(ctx.report.gates);
    assert.ok(!text.includes(SECRET));
    const fs = await import('node:fs');
    const path = await import('node:path');
    const logs = fs.readFileSync(path.join(ctx.report.outDir, 'evidence', 'all-container-logs.txt'), 'utf8');
    assert.ok(!logs.includes(SECRET));
    assert.match(logs, /\[REDACTED\]/);
  });
});
