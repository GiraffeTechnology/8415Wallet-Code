/** Public V2 contains only its explicit module closure, never a disabled V3 payload. */
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, join } from 'node:path';
import { walk, validateStaticTree, sha256 } from './dapp-release.mjs';
const require = createRequire(import.meta.url);
const forbidden = /^(?:src|server|vendor|contracts|tests|\.git)\/|^dist\/browser\/(?:controls\/|sdk\/linked\.js$|wallet\/(?:linkedChainView|renderLinkedChain)\.js$)|^web\/(?:app\.mjs|public-store\.mjs|forward-progress-panel\.mjs)$/;
const linkedSymbols = /\b(?:ResponsibilityWalletSession|ResponsibilityControlClient|NativeResponsibilityPaymentClient|ForwardConsentReview|DetachedResponsibilityHistoryClient|buildLinkedChainView|renderLinkedChain|signForwardConsent|forwardConsentDigest|encodeForward)\b/;
function target(root, present, file, specifier) {
  if (!specifier.startsWith('.')) throw new Error(`V2_NONLOCAL_IMPORT: ${file}`);
  const path = relative(root, resolve(root, dirname(file), specifier)).split('\\').join('/');
  if (!present.has(path)) throw new Error(`V2_UNRESOLVED_IMPORT: ${file} -> ${specifier}`);
  if (forbidden.test(path)) throw new Error(`V2_PRIVATE_MODULE_REFUSED: ${path}`);
  return path;
}
export function publicV2ModuleClosure(root) {
  const ts = require('typescript'), files = walk(root), present = new Set(files);
  const roots = ['web/release-profile.mjs'];
  const page = readFileSync(join(root, 'web/index.html'), 'utf8');
  for (const match of page.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) roots.push(target(root,present,'web/index.html','./'+match[1]));
  const visited = new Set();
  function visitFile(file) {
    if (visited.has(file)) return;
    if (!present.has(file)) throw new Error(`V2_UNRESOLVED_IMPORT: ${file}`);
    if (forbidden.test(file)) throw new Error(`V2_PRIVATE_MODULE_REFUSED: ${file}`);
    visited.add(file);
    const text=readFileSync(join(root,file),'utf8');
    if (linkedSymbols.test(text)) throw new Error(`V2_PRIVATE_IMPLEMENTATION_REFUSED: ${file}`);
    const ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    if(ast.parseDiagnostics.length) throw new Error(`V2_MODULE_SYNTAX_REFUSED: ${file}`);
    function visit(node) {
      if ((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) {
        if(!ts.isStringLiteral(node.moduleSpecifier))throw new Error('V2_IMPORT_LITERAL_REQUIRED');
        visitFile(target(root,present,file,node.moduleSpecifier.text));
      }
      if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
        if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw new Error('V2_DYNAMIC_IMPORT_REFUSED');
        visitFile(target(root,present,file,node.arguments[0].text));
      }
      ts.forEachChild(node,visit);
    }
    visit(ast);
  }
  roots.forEach(visitFile);
  return [...visited].sort();
}
export function isolateV2Stage(root) {
  copyFileSync(join(root,'web/index-v2.html'),join(root,'web/index.html'));
  copyFileSync(join(root,'web/release-profile-v2.mjs'),join(root,'web/release-profile.mjs'));
  copyFileSync(join(root,'dist/browser/browser-v2.js'),join(root,'dist/browser/browser.js'));
  const allowed=new Set(publicV2ModuleClosure(root));
  for(const file of walk(root)) {
    if ((/\.(?:mjs|js)$/.test(file)&&!allowed.has(file)) || (file.startsWith('web/')&&file.endsWith('.html')&&file!=='web/index.html')) rmSync(join(root,file));
  }
  validateStaticTree(root);
  return {schema:'8415wallet-v2-code-isolation/1',moduleFiles:[...allowed].sort(),linkedImplementationIncluded:false};
}
export function verifyV2Isolation(root) {
  const validation=validateStaticTree(root), modules=publicV2ModuleClosure(root);
  const all=walk(root);
  for(const file of all)if(forbidden.test(file)||/\.(?:tar|tgz|zip)(?:\.gz)?$/.test(file))throw new Error(`V2_PRIVATE_FILE_REFUSED: ${file}`);
  const actual=all.filter(f=>/\.(?:mjs|js)$/.test(f));
  if(JSON.stringify(actual)!==JSON.stringify(modules))throw new Error('V2_UNREACHABLE_MODULE_REFUSED');
  return {schema:'8415wallet-v2-code-isolation/1',moduleFiles:modules,linkedImplementationIncluded:false,
    runtimeFiles:Object.fromEntries(validation.files.map(f=>[f,sha256(readFileSync(join(root,f)))]))};
}
