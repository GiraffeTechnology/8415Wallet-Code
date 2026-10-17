import { mountKitRead } from '../web/kit-read-panel.mjs';
import { mountWatchtowerRead } from '../web/watchtower-read-panel.mjs';
import { declarationFile, inputsOf, runPanelLifecycleCases } from './helpers/readonly-panel-harness.mjs';
import { runAssetWorkspaceCases } from './helpers/asset-workspace-harness.mjs';
import { runTaskActivityCases } from './helpers/task-activity-harness.mjs';

/**
 * The read-only panels that import dist/browser/browser.js at module scope.
 *
 * They can only be imported once the browser build has produced that file, so
 * a workflow step after the build owns this suite rather than npm test. It is
 * .mjs deliberately: the tests/**\/*.test.ts glob would otherwise run it
 * during npm test, before the build, and the import would fail the file.
 */

runPanelLifecycleCases({
  label: 'Kit display read',
  mount: mountKitRead,
  readKey: 'kit.read',
  errorKey: 'kit.error',
  prepare: host => {
    const [basePath, instant] = inputsOf(host, 'text');
    basePath.value = '/kit';
    instant.value = '1000';
  },
});

runPanelLifecycleCases({
  label: 'watchtower comparison',
  mount: mountWatchtowerRead,
  readKey: 'wt.read',
  errorKey: 'wt.error',
  prepare: host => {
    inputsOf(host, 'file')[0].files = [declarationFile()];
    inputsOf(host, 'text')[0].value = '1000';
  },
});

// Needs the build too: task-authorization imports four dist/browser modules.
runTaskActivityCases();

// The workspace panel's whole closure is itself and dist/browser/browser.js.
runAssetWorkspaceCases();
