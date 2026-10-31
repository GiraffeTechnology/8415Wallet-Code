/** Private V3 composition, selected explicitly by the V3 package builder. */
import {copyFileSync,readFileSync,rmSync} from 'node:fs';
import {join,dirname,relative,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {walk,validateStaticTree} from './dapp-release.mjs';
const require=createRequire(import.meta.url);
export function privateV3ModuleClosure(root){
 const ts=require('typescript'),present=new Set(walk(root)),visited=new Set();
 const target=(file,specifier)=>{
  if(!specifier.startsWith('.'))throw Error('V3_NONLOCAL_IMPORT');
  const path=relative(root,resolve(root,dirname(file),specifier)).split('\\').join('/');
  if(!present.has(path))throw Error('V3_UNRESOLVED_IMPORT: '+file+' -> '+specifier);
  return path;
 };
 const visit=file=>{
  if(visited.has(file))return;visited.add(file);
  const ast=ts.createSourceFile(file,readFileSync(join(root,file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(ast.parseDiagnostics.length)throw Error('V3_MODULE_SYNTAX_REFUSED');
  const walkNode=node=>{
   if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier){
    if(!ts.isStringLiteral(node.moduleSpecifier))throw Error('V3_IMPORT_LITERAL_REQUIRED');
    visit(target(file,node.moduleSpecifier.text));
   }
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword){
    if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw Error('V3_DYNAMIC_IMPORT_REFUSED');
    visit(target(file,node.arguments[0].text));
   }
   ts.forEachChild(node,walkNode);
  };walkNode(ast);
 };
 visit('web/release-profile.mjs');
 for(const m of readFileSync(join(root,'web/index.html'),'utf8').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g))visit(target('web/index.html','./'+m[1]));
 return [...visited].sort();
}
export function stageV3Composition(root){
 const entry=join(root,'web/index-v3.html'),html=readFileSync(entry,'utf8');
 for(const name of ['app.mjs','external-assets.mjs','legacy-clearing.mjs','task-ui-v3.mjs','wallet-auth.mjs','asset-control-startup.mjs']){
  if([...html.matchAll(new RegExp('src="'+name.replaceAll('.','\\.')+'"','g'))].length!==1)throw Error('V3_UI_COMPOSITION_REFUSED');
 }
 if(/src="app-v2\.mjs"/.test(html))throw Error('V3_UI_PROFILE_REFUSED');
 copyFileSync(entry,join(root,'web/index.html'));
 const closure=new Set(privateV3ModuleClosure(root));
 for(const file of walk(root))if(/\.(?:mjs|js)$/.test(file)&&!closure.has(file))rmSync(join(root,file));
 validateStaticTree(root);
 for(const name of ['index-v2.html','index-v3.html'])rmSync(join(root,'web',name),{force:true});
}
