import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import * as tls from 'node:tls';

export interface TlsFixture {
  port: number;
  ca1Cert: string;
  ca2Cert: string;
  serverCert: string;
  close: () => Promise<void>;
}

export async function createPostgresTlsFixture(): Promise<TlsFixture> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'floz-tls-fixture-'));
  const env = { ...process.env };
  const opensslCnf = 'C:\\Program Files\\Git\\mingw64\\etc\\ssl\\openssl.cnf';
  if (fs.existsSync(opensslCnf)) {
    env.OPENSSL_CONF = opensslCnf;
  }

  // Generate trusted Root CA 1
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout ca1.key -out ca1.crt -days 1 -subj "/CN=Test CA 1"', {
    env,
    cwd: tmpDir,
    stdio: 'ignore'
  });

  // Generate untrusted Root CA 2
  execSync('openssl req -x509 -newkey rsa:2048 -nodes -keyout ca2.key -out ca2.crt -days 1 -subj "/CN=Test CA 2"', {
    env,
    cwd: tmpDir,
    stdio: 'ignore'
  });

  // Generate Server CSR and sign with CA 1, SAN = db.floz.local, IP = 127.0.0.1
  fs.writeFileSync(path.join(tmpDir, 'san.ext'), 'subjectAltName = DNS:db.floz.local, IP:127.0.0.1\n');
  execSync('openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=db.floz.local"', {
    env,
    cwd: tmpDir,
    stdio: 'ignore'
  });
  execSync('openssl x509 -req -in server.csr -CA ca1.crt -CAkey ca1.key -CAcreateserial -out server.crt -days 1 -extfile san.ext', {
    env,
    cwd: tmpDir,
    stdio: 'ignore'
  });

  const ca1Cert = fs.readFileSync(path.join(tmpDir, 'ca1.crt'), 'utf8');
  const ca2Cert = fs.readFileSync(path.join(tmpDir, 'ca2.crt'), 'utf8');
  const serverCert = fs.readFileSync(path.join(tmpDir, 'server.crt'), 'utf8');
  const serverKey = fs.readFileSync(path.join(tmpDir, 'server.key'), 'utf8');

  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));

    socket.once('data', (data) => {
      // Check for PostgreSQL SSLRequest (8 bytes: 00 00 00 08 04 d2 16 2f)
      if (data.length === 8 && data.readInt32BE(0) === 8 && data.readInt32BE(4) === 80877103) {
        socket.write(Buffer.from([0x53])); // 'S' -> accept TLS negotiation
        const tlsSocket = new tls.TLSSocket(socket, {
          isServer: true,
          cert: serverCert,
          key: serverKey
        });

        tlsSocket.on('data', (buf) => {
          if (buf[0] === 0x51) {
            // 'Q' -> Query -> respond CommandComplete 'SELECT 1' + ReadyForQuery
            const tag = Buffer.from('SELECT 1\0');
            const cmd = Buffer.alloc(1 + 4 + tag.length);
            cmd[0] = 0x43;
            cmd.writeInt32BE(4 + tag.length, 1);
            tag.copy(cmd, 5);
            const ready = Buffer.from([0x5a, 0x00, 0x00, 0x00, 0x05, 0x49]);
            tlsSocket.write(Buffer.concat([cmd, ready]));
          } else {
            // StartupMessage -> respond AuthOk + ReadyForQuery
            const authOk = Buffer.from([0x52, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]);
            const ready = Buffer.from([0x5a, 0x00, 0x00, 0x00, 0x05, 0x49]);
            tlsSocket.write(Buffer.concat([authOk, ready]));
          }
        });
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    ca1Cert,
    ca2Cert,
    serverCert,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}
