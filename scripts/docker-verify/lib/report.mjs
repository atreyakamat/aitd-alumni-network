// The evidence bundle: every gate with its result, the files that back it, and a SHA-256 manifest so the bundle can be
// checked later (`sha256sum -c manifest.sha256`). Secret values are replaced by [REDACTED] in everything written here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const walk = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'private' ? [] : walk(full, base);
    return [path.relative(base, full).split(path.sep).join('/')];
  });

export const createReport = ({ outDir, secrets = [], now = () => new Date() }) => {
  fs.mkdirSync(path.join(outDir, 'evidence'), { recursive: true });
  const redactions = new Set();
  const addSecrets = (values) => values.filter((value) => value && String(value).length >= 8).forEach((value) => redactions.add(String(value)));
  addSecrets(secrets);

  const redact = (text) => {
    let out = String(text ?? '');
    for (const secret of redactions) out = out.split(secret).join('[REDACTED]');
    return out;
  };

  const gates = [];
  const startedAt = now();

  const evidence = (name, text) => {
    const file = safeName(name);
    fs.writeFileSync(path.join(outDir, 'evidence', file), redact(text));
    return `evidence/${file}`;
  };

  const record = ({ id, phase, title, status, detail = '', ms = 0, files = [] }) => {
    const entry = { id, phase, title, status, detail: redact(detail).slice(0, 2000), ms, evidence: files };
    gates.push(entry);
    return entry;
  };

  const counts = () => ({
    pass: gates.filter((gate) => gate.status === 'pass').length,
    fail: gates.filter((gate) => gate.status === 'fail').length,
    skip: gates.filter((gate) => gate.status === 'skip').length,
  });

  const markdown = (meta) => {
    const c = counts();
    const verdict = c.fail === 0 ? 'PASS' : 'FAIL';
    const icon = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' };
    const lines = [
      `# Docker and Kafka verification: ${verdict}`,
      '',
      `* **Result:** ${c.pass} passed, ${c.fail} failed, ${c.skip} skipped`,
      `* **Commit:** \`${meta.commit ?? 'unknown'}\`${meta.dirty ? ' (working tree had uncommitted changes)' : ''}`,
      `* **Started:** ${startedAt.toISOString()}  **Finished:** ${meta.finishedAt}`,
      `* **Host:** ${meta.hostname} (${meta.platform}); node ${meta.node}; ${meta.dockerVersion ?? 'docker: n/a'}; ${meta.composeVersion ?? 'compose: n/a'}`,
      `* **Mode:** ${meta.mode}`,
      '',
      '## Gates',
      '',
      '| # | Result | Gate | Detail |',
      '|---|---|---|---|',
      ...gates.map((gate) => `| ${gate.id} | ${icon[gate.status]} | ${gate.title} | ${gate.detail.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 220)} |`),
      '',
    ];
    const failures = gates.filter((gate) => gate.status === 'fail');
    if (failures.length) {
      lines.push('## Failures (what to send back for a fix)', '');
      for (const gate of failures) {
        lines.push(`### ${gate.id} ${gate.title}`, '', gate.detail || '(no detail)', '', ...(gate.evidence.length ? [`Evidence: ${gate.evidence.map((file) => `\`${file}\``).join(', ')}`, ''] : []));
      }
    }
    lines.push(
      '## Checking this bundle',
      '',
      'Every file in this folder is listed with its SHA-256 in `manifest.sha256`. To check nothing was changed afterwards:',
      '',
      '```bash',
      'sha256sum -c manifest.sha256',
      '```',
      '',
      `Compare the commit above with \`git rev-parse HEAD\` of the code that was tested.`,
      ''
    );
    return lines.join('\n');
  };

  const finish = (meta) => {
    const finishedAt = now().toISOString();
    const full = { ...meta, finishedAt };
    const c = counts();
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ...full, startedAt: startedAt.toISOString(), counts: c, ok: c.fail === 0, gates }, null, 2));
    fs.writeFileSync(path.join(outDir, 'REPORT.md'), markdown(full));
    const files = walk(outDir).filter((file) => file !== 'manifest.sha256');
    fs.writeFileSync(path.join(outDir, 'manifest.sha256'), files.sort().map((file) => `${sha256(path.join(outDir, file))}  ${file}`).join('\n') + '\n');
    return { counts: c, ok: c.fail === 0 };
  };

  return { gates, record, evidence, redact, addSecrets, counts, finish, outDir };
};
