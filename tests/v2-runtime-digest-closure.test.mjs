import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {posix} from 'node:path';
import ts from 'typescript';
import {TASK_EXACT_SIGNER_RUNTIME_FILES} from '../server/v2/task-exact-signer-adapter.mjs';
import {TASK_EXACT_PLANNER_RUNTIME_FILES} from '../server/v2/task-exact-operation-planner.mjs';
import {TASK_RECEIPT_RUNTIME_FILES} from '../server/v2/task-receipt-adapter.mjs';
const roots=['server/v2/task-exact-signer-adapter.mjs','server/v2/task-exact-operation-planner.mjs','server/v2/task-receipt-adapter.mjs','server/v2/main.mjs','server/v2/runtime-entry.mjs'];
test('V2 implementation identities include the exact complete executed local import closure without private V3 roots',()=>{
 const seen=new Set();function visit(file){if(seen.has(file))return;seen.add(file);const text=readFileSync(new URL('../'+file,import.meta.url),'utf8'),tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
 function walk(n){if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)&&!n.isTypeOnly&&!n.importClause?.isTypeOnly){const value=n.moduleSpecifier.text;if(value.startsWith('.'))visit(posix.normalize(posix.join(posix.dirname(file),value)));}
 if(ts.isCallExpression(n)&&n.expression.kind===ts.SyntaxKind.ImportKeyword){const value=n.arguments[0];if(ts.isStringLiteral(value)&&value.text.startsWith('.'))visit(posix.normalize(posix.join(posix.dirname(file),value.text)));}ts.forEachChild(n,walk);}walk(tree);}
 roots.forEach(visit);const expected=[...seen].sort();
 for(const list of [TASK_EXACT_SIGNER_RUNTIME_FILES,TASK_EXACT_PLANNER_RUNTIME_FILES,TASK_RECEIPT_RUNTIME_FILES])assert.deepEqual(list,expected);
 const inventory=JSON.parse(readFileSync(new URL('../server/v2/runtime-files.json',import.meta.url),'utf8'));assert.equal(inventory.schema,'8415wallet-v2-runtime-files/1');assert.deepEqual(inventory.files,expected);
 for(const file of expected)assert.doesNotMatch(file,/src\/controls\/|src\/sdk\/linked|server\/(?:task-exact-signer-adapter|task-exact-operation-planner|task-receipt-adapter|task-operation-encoding|task-exact-runtime)\.mjs$/);
});
