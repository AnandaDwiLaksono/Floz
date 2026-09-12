import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const run = (mode) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['test/fixtures/sigterm-proof.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, MODE: mode } });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (output.includes('READY\n') && !child.killed) child.kill('SIGTERM');
  });
  child.on('error', reject);
  child.on('exit', (code) => {
    const traceLine = output.trim().split('\n').findLast((line) => line.startsWith('{'));
    assert.ok(traceLine, output);
    const trace = JSON.parse(traceLine);
    resolve({ code, events: trace.events });
  });
});

const graceful = await run('graceful');
assert.equal(graceful.code, 0, JSON.stringify(graceful));
assert.deepEqual(graceful.events, [
  'request.admitted', 'readiness.stop', 'late.status.503', 'late.rejected', 'request.drained',
  'app.close', 'auth.close', 'database.close', 'exit.0'
]);
for (const event of ['readiness.stop', 'app.close', 'auth.close', 'database.close', 'exit.0']) {
  assert.equal(graceful.events.filter((value) => value === event).length, 1);
}
process.stdout.write(`${JSON.stringify({ image: process.version, graceful })}\n`);
