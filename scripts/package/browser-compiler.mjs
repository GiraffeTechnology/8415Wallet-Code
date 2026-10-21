/** Compile the configured browser graph in the packaging process itself.
 * Keep the lockfile-pinned TypeScript checks without retaining a second Node
 * process while its compiler is live. Static validation remains a later step.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export function compileBrowser(root = process.cwd()) {
  const ts = require('typescript');
  const directory = resolve(root);
  const formatHost = {
    getCanonicalFileName: path => path,
    getCurrentDirectory: () => directory,
    getNewLine: () => ts.sys.newLine,
  };
  const refuse = diagnostics => {
    throw new Error(`DAPP_BROWSER_COMPILE_FAILED\n${ts.formatDiagnostics(diagnostics, formatHost)}`);
  };
  const fatal = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(directory, 'tsconfig.browser.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: diagnostic => fatal.push(diagnostic),
  });
  if (fatal.length || !parsed) refuse(fatal);
  if (parsed.errors.length) refuse(parsed.errors);
  if (parsed.options.noEmit) throw new Error('DAPP_BROWSER_EMIT_REQUIRED');
  const input = {
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: parsed.errors,
  };
  const builder = parsed.options.incremental || parsed.options.composite ? ts.createIncrementalProgram(input) : null;
  const program = builder ? builder.getProgram() : ts.createProgram(input);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) refuse(diagnostics);
  const emitted = builder ? builder.emit() : program.emit();
  if (emitted.diagnostics.length) refuse(emitted.diagnostics);
  if (emitted.emitSkipped) throw new Error('DAPP_BROWSER_EMIT_SKIPPED');
  return { typescript: ts.version, inputFiles: parsed.fileNames.length };
}
