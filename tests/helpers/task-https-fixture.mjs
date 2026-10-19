/** Synthetic loopback mTLS fixtures shared by approved-server tests. */
import { createServer } from 'node:https';
import { once } from 'node:events';
import { X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile, chmod, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function privateFixtureDirectory(t) {
 // Production validates every ancestor; system temp can be world-writable.
 // A unique directory directly in the canonical checkout needs no shared parent.
 const directory=await mkdtemp(join(await realpath(process.cwd()),'.task-listing-bootstrap-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));return directory;
}
export async function certificates(t) {
 const directory=await privateFixtureDirectory(t);
 const result={directory};
 for(const name of ['wallet','journal']){
  const key=join(directory,`${name}.key`),cert=join(directory,`${name}.crt`);
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-keyout',key,'-out',cert,'-days','1','-nodes','-subj','/CN=localhost','-addext',`subjectAltName=DNS:localhost,IP:127.0.0.1,URI:spiffe://artfi/${name}`,'-addext','extendedKeyUsage=serverAuth,clientAuth'],{stdio:'ignore'});
  await chmod(key,0o600);await chmod(cert,0o600);const certBytes=await readFile(cert);
  result[name]={key,cert,keyBytes:await readFile(key),certBytes,fingerprint:new X509Certificate(certBytes).fingerprint256.replaceAll(':','').toLowerCase()};
 }
 result.ca=join(directory,'ca.crt');await writeFile(result.ca,Buffer.concat([result.wallet.certBytes,result.journal.certBytes]),{mode:0o600});result.caBytes=await readFile(result.ca);return result;
}
export async function service(t,certs,handler){const s=createServer({cert:certs.journal.certBytes,key:certs.journal.keyBytes,ca:certs.caBytes,requestCert:true,rejectUnauthorized:true},handler);s.listen(0,'127.0.0.1');await once(s,'listening');t.after(()=>new Promise(r=>s.close(r)));return{server:s,url:`https://127.0.0.1:${s.address().port}`};}
