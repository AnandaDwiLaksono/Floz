import http from 'node:http';
import { ApiShutdownCoordinator } from '../../dist/src/api-shutdown-coordinator.js';

const events = [];
let release;
const held = new Promise((resolve) => { release = resolve; });
const readiness = { stop() { events.push('readiness.stop'); } };
const app = { async close() {
  events.push('app.close', 'auth.close', 'database.close');
  if (process.env.MODE === 'forced') await new Promise(() => {});
} };
let coordinator;
const server = http.createServer((request, response) => {
  coordinator.admissionGate(request, response, () => {
    if (request.url === '/hold') {
      events.push('request.admitted');
      void held.then(() => { events.push('request.drained'); response.end('drained'); });
      return;
    }
    events.push('late.admitted');
    response.end('unexpected');
  });
});
const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
coordinator = new ApiShutdownCoordinator(app, server, readiness, {
  forceTimeoutMs: 1000,
  hardDeadlineMs: 2000,
  exit(code) {
    events.push(`exit.${code}`);
    process.stdout.write(`${JSON.stringify({ events })}\n`);
    process.exitCode = code;
    agent.destroy();
  },
  hardTerminate() {
    events.push('hardTerminate', 'exit.1');
    process.stdout.write(`${JSON.stringify({ events })}\n`);
    process.exit(1);
  }
});
coordinator.install();
process.once('SIGTERM', () => {
  setTimeout(() => {
    coordinator.admissionGate({}, {
      status(code) {
        events.push(`late.status.${code}`);
        return { end() { events.push('late.rejected'); } };
      }
    }, () => events.push('late.admitted'));
    if (process.env.MODE !== 'forced') release();
  }, 25);
});
server.listen(0, '127.0.0.1', () => {
  http.get({ host: '127.0.0.1', port: server.address().port, path: '/hold', agent }, (response) => {
    response.resume();
    response.on('end', () => agent.destroy());
  });
  setTimeout(() => process.stdout.write('READY\n'), 25);
});
