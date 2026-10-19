/** Synthetic SMTP composition only. No real mail server, account or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Duplex } from 'node:stream';
import { createSmtpOtpSender, OTP_FROM, OTP_HOST } from '../server/mail-otp.mjs';
function fakeSmtp(options: any = {}) {
  const wire: string[] = [], connection: any[] = []; let data = false;
  class Socket extends Duplex {
    encrypted = true; authorized = options.authorized !== false;
    getProtocol() { return options.protocol ?? 'TLSv1.3'; }
    override _read() {}
    override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
      const line = chunk.toString(); wire.push(line);
      const reply = (value: string) => queueMicrotask(() => { if (!this.destroyed) this.push(`${value}\r\n`); });
      if (data) { data = false; if (!options.missingAcceptance) reply(options.rejectData ? '550 rejected' : '250 queued'); }
      else if (line.startsWith('EHLO')) reply(options.noAuth ? '250 hello' : '250-mail.example.invalid\r\n250-AUTH PLAIN\r\n250 SIZE 100000');
      else if (line.startsWith('AUTH')) reply(options.rejectAuth ? '535 failed synthetic-private-detail' : '235 authenticated');
      else if (line.startsWith('MAIL') || line.startsWith('RCPT')) reply('250 ok');
      else if (line.startsWith('DATA')) { data = true; reply('354 continue'); }
      done();
    }
  }
  const connect = (config: any) => { connection.push(config); const socket = new Socket(); queueMicrotask(() => { socket.emit('secureConnect'); socket.push('220 synthetic SMTP\r\n'); }); return socket; };
  return { connect, wire, connection };
}

const base = { to: 'owner@example.invalid', code: '12345678', expiresAt: 1900000300000,
  tenant: 'synthetic', origin: 'https://wallet.example.invalid', changeDigest: 'a'.repeat(64) };
for (const mode of ['on', 'off']) test('fixed sender composes exact owner policy ' + mode + ' change without enrollment/reset disguise', async () => {
  const smtp = fakeSmtp(), send = createSmtpOtpSender({ port: 465, username: 'synthetic', password: 'synthetic', connect: smtp.connect });
  assert.deepEqual(await send({ ...base, purpose: 'task-verification-policy-' + mode }), { accepted: true });
  const wire = smtp.wire.join('');
  assert.equal(smtp.connection.length, 1); assert.equal(smtp.connection[0].host, OTP_HOST);
  assert.equal(smtp.connection[0].rejectUnauthorized, true); assert.equal(smtp.connection[0].minVersion, 'TLSv1.2');
  assert.ok(wire.includes('MAIL FROM:<' + OTP_FROM + '>'));
  assert.ok(wire.includes('Setting: Per-operation human verification ' + mode.toUpperCase()));
  assert.ok(wire.includes('Change digest: ' + base.changeDigest)); assert.ok(wire.includes('cannot log you in or approve a transaction'));
  assert.doesNotMatch(wire, /reserved email enrollment|security reset code|AUTH LOGIN|STARTTLS/);
});
test('policy purpose without exact canonical digest refuses before opening SMTP; email-login purpose remains forbidden', async () => {
  const smtp = fakeSmtp(), send = createSmtpOtpSender({ port: 465, username: 'synthetic', password: 'synthetic', connect: smtp.connect });
  for (const changeDigest of [undefined, '', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '\r\nBcc: x@example.invalid'])
    await assert.rejects(send({ ...base, purpose: 'task-verification-policy-on', changeDigest }), /AUTH_EMAIL_UNAVAILABLE/);
  await assert.rejects(send({ ...base, purpose: 'login' }), /AUTH_EMAIL_UNAVAILABLE/);
  assert.equal(smtp.connection.length, 0);
});
