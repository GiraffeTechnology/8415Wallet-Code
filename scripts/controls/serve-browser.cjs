const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');

// Development-only server: loopback, GET/HEAD and two public static trees only.
// It has no RPC forwarding, signing, secret loading, upload or write endpoint.
const root=path.resolve(__dirname,'../..');
// Only an explicitly requested loopback test URL can assemble retained modules.
// The default /web/index.html remains its exact source bytes.
const testComposition=process.env.WALLET_BROWSER_TEST_COMPOSITION || null;
const testFixture=testComposition ? require('../../tests/helpers/enabled-composition.cjs') : null;
if(testFixture) testFixture.fixturePath(testComposition);
const port=Number(process.env.WALLET_BROWSER_PORT??'8415');
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('BROWSER_PORT_REFUSED');
const web=new Set(['index.html','login-core.mjs','wallet-auth.mjs','account-auth.mjs','app.mjs','public-store.mjs','wallet.css','external-assets.mjs','external-store.mjs','ui-lock.mjs','release-profile.mjs','release-config.json','settlement-store.mjs','legacy-clearing.mjs','legacy-clearing-store.mjs','i18n.mjs','locale-ui.mjs','native-i18n.mjs','wallet-shell.mjs','tenant-avatar.mjs']);
web.add('method-change-ui.mjs');
web.add('escrow-ordering-i18n.mjs');
web.add('enrollment-qr.mjs'); web.add('qr-generator.mjs');
web.add('task-listing-results.mjs');
for (const module of ['task-activity.mjs','task-activity-ui.mjs','asset-workspace-panel.mjs','hoodi-journey-panel.mjs']) web.add(module);
web.add('task-ui.mjs'); web.add('task-authorization.mjs'); web.add('task-authorization-ui.mjs');
web.add('tenant-password-routing.mjs'); web.add('tenant-password-ui.mjs'); web.add('tenant-password-routing.json');
// Every module reachable from index.html must be listed, including the ones a
// panel pulls in. A module app.mjs imports but this set omits 404s, so the
// panel is dead in the served app; tests/task-static-module-closure.test.mjs
// walks the whole graph and is what catches an omission here.
// Read-only panels and their own modules.
web.add('hoodi-journey-panel.mjs');
web.add('asset-workspace-panel.mjs');
web.add('audit-export-panel.mjs'); web.add('audit-export.mjs');
web.add('feed-continuity-panel.mjs'); web.add('feed-continuity.mjs');
web.add('watchtower-read-panel.mjs'); web.add('watchtower-read.mjs');
web.add('kit-read-panel.mjs'); web.add('kit-read.mjs');
web.add('task-activity-ui.mjs'); web.add('task-activity.mjs');
// Shared by those panels. The locales they read are served by the web/locales/ rule.
web.add('readonly-i18n.mjs'); web.add('trading-observation.mjs');
// Retained candidate entry points and their public read/settings dependencies.
// Keep exact filenames: this must not expose arbitrary web or server sources.
web.add('about-entry.mjs'); web.add('about.mjs');
web.add('forward-progress-client.mjs'); web.add('forward-progress-panel.mjs');
web.add('task-observer-context.mjs'); web.add('observation-source-contract.mjs');
web.add('observation-details-flow.mjs'); web.add('observation-details-ui.mjs');
web.add('task-verification-policy-startup.mjs'); web.add('task-verification-policy-entry.mjs');
web.add('task-verification-policy-client.mjs'); web.add('task-verification-policy-wire.mjs');
web.add('task-verification-policy-ceremony.mjs'); web.add('task-verification-policy-ui.mjs');
web.add('wallet-identity-display.mjs');
const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; font-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)||!['GET','HEAD'].includes(req.method)) {res.writeHead(403);res.end();return;}
  if(testFixture && testFixture.serveEnabledComposition(req,res,{root,composition:testComposition})) return;
  if(req.url==='/'){res.writeHead(302,{Location:'/web/index.html'});res.end();return;}
  let relative;
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.search||url.hash)throw new Error();
    relative=decodeURIComponent(url.pathname).slice(1);
    if(relative==='')relative='web/index.html';
    if(relative.includes('\\')||relative.split('/').some(s=>s==='..'||s==='.'||s===''))throw new Error();
    if(!(relative.startsWith('web/')&&(web.has(relative.slice(4))||/^web\/locales\/[A-Za-z0-9-]+\.mjs$/.test(relative)||/^web\/assets\/[A-Za-z0-9-]+\.(?:jpg|jpeg|png|webp|svg|woff2|ttf|txt)$/.test(relative)))&&
       !(relative.startsWith('dist/browser/')&&/^[a-zA-Z0-9_/-]+\.js$/.test(relative)))throw new Error();
    const full=path.resolve(root,relative),segments=relative.split('/');let at=root;
    for(const segment of segments){at=path.join(at,segment);if(fs.lstatSync(at).isSymbolicLink())throw new Error();}
    const stat=fs.lstatSync(full);if(!stat.isFile()||stat.nlink!==1||stat.size>2000000)throw new Error();
    res.setHeader('Content-Type',mime[path.extname(full)]??'application/octet-stream');
    res.writeHead(200);res.end(req.method==='HEAD'?undefined:fs.readFileSync(full));
  }catch{res.writeHead(404);res.end();}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`8415Wallet browser available on loopback port ${port}; development-only\n`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
