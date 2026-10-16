import { mountAuditExport } from '../web/audit-export-panel.mjs';
import { mountFeedContinuity } from '../web/feed-continuity-panel.mjs';
import { declarationFile, inputsOf, runPanelLifecycleCases } from './helpers/readonly-panel-harness.mjs';

/**
 * The read-only panels with no build dependency, driven inside npm test.
 *
 * The Kit and watchtower panels import dist/browser/browser.js at module
 * scope, so they cannot be imported before the browser build has run and are
 * covered by readonly-panel-browser-lifecycle.test.mjs instead. Importing them
 * here would fail the whole file on a clean checkout, where npm test runs
 * before that build.
 */

runPanelLifecycleCases({
  label: 'custody audit export',
  mount: mountAuditExport,
  readKey: 'audit.read',
  errorKey: 'audit.error',
  prepare: () => {},
});

runPanelLifecycleCases({
  label: 'feed continuity review',
  mount: mountFeedContinuity,
  readKey: 'feed.read',
  errorKey: 'feed.error',
  prepare: (host: any) => { inputsOf(host, 'file')[0].files = [declarationFile()]; },
});
