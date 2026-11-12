/**
 * The dead-letter topic, from the command line (docs/KAFKA.md). Replay and purge only show what they WOULD do until --yes is given.
 *
 *   node dist/scripts/dlq.js list [--limit 100] [--json]
 *   node dist/scripts/dlq.js replay (--all | --offset 0:12 [--offset 0:13]) [--yes]
 *   node dist/scripts/dlq.js purge [--yes]
 *
 * In Docker:  docker compose exec api node dist/scripts/dlq.js list      From source:  npm run dlq -w server -- list
 */
import { getKafka, readKafkaSettings } from '../config/kafka';
import { readDeadLetters, replayDeadLetters, purgeDeadLetters } from '../services/deadLetterService';

export interface DlqArgs {
  command: 'list' | 'replay' | 'purge';
  limit: number;
  all: boolean;
  offsets: string[];
  yes: boolean;
  json: boolean;
}

export const parseArgs = (argv: string[]): DlqArgs => {
  const [command, ...rest] = argv;
  if (!['list', 'replay', 'purge'].includes(command ?? '')) throw new Error('Usage: dlq <list|replay|purge> [options]');
  const args: DlqArgs = { command: command as DlqArgs['command'], limit: 100, all: false, offsets: [], yes: false, json: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--all') args.all = true;
    else if (flag === '--yes') args.yes = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--limit') {
      const value = Number(rest[++i]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--limit needs a whole number of at least 1');
      args.limit = value;
    } else if (flag === '--offset') {
      const value = rest[++i];
      if (!value) throw new Error('--offset needs a partition:offset pair such as 0:12');
      args.offsets.push(value);
    } else throw new Error(`Unknown option ${flag}`);
  }
  return args;
};

const out = (text: string) => process.stdout.write(`${text}\n`);

export const main = async (argv: string[]): Promise<number> => {
  const args = parseArgs(argv);
  const settings = readKafkaSettings();
  if (!settings.enabled) {
    out('Kafka is not configured (KAFKA_BROKERS is empty): there is no dead-letter topic.');
    return 1;
  }
  const kafka = getKafka(settings);

  if (args.command === 'list') {
    const letters = await readDeadLetters(kafka, settings, { limit: args.limit });
    if (args.json) out(JSON.stringify(letters, null, 2));
    else if (letters.length === 0) out('The dead-letter topic is empty.');
    else {
      out(`${letters.length} dead letter(s) in ${settings.dlqTopic}:\n`);
      for (const l of letters) {
        out(`  ${l.partition}:${l.offset}  ${l.failedAt ?? ''}  ${l.reason ?? '?'}  ${l.type ?? '(not an event)'}  ${l.eventId ?? ''}`);
        if (l.error) out(`      ${l.error}`);
      }
    }
    return 0;
  }

  if (args.command === 'replay') {
    const result = await replayDeadLetters(kafka, settings, { all: args.all, offsets: args.offsets }, { dryRun: !args.yes });
    out(`${result.dryRun ? 'DRY RUN: would replay' : 'Replayed'} ${result.replayed.length} event(s) to ${settings.topic}.`);
    for (const r of result.replayed) out(`  ${r.partition}:${r.offset}  ${r.type}  ${r.eventId}`);
    for (const s of result.skipped) out(`  SKIPPED ${s.partition}:${s.offset}: ${s.why}`);
    if (result.dryRun && result.replayed.length) out('\nNothing was sent. Run again with --yes to replay them.');
    return 0;
  }

  const result = await purgeDeadLetters(kafka, settings, { dryRun: !args.yes });
  out(`${result.dryRun ? 'DRY RUN: would delete' : 'Deleted'} ${result.count} message(s) from ${settings.dlqTopic}.`);
  if (result.dryRun && result.count) out('\nNothing was deleted. Run again with --yes to delete them. Replay first what you still want.');
  return 0;
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exit(2);
    }
  );
}
