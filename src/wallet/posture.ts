import type { FinalityView } from './finality.ts';
import type { FreshnessView } from './freshness.ts';

/**
 * The projection's answer and the feed's currency, shown together.
 *
 * The two signals are computed apart and must stay apart — that is the point
 * of the freshness layer. But keeping them apart and *never showing them
 * together* is where the conflation actually happens: a stale feed and an open
 * gap look alike to a reader who sees only one at a time, which makes a
 * silently dead register indistinguishable from ordinary delay.
 *
 * So this reports the pair, with stale as its own case. It reports; it does
 * not decide. What a given asset warrants — release, hold, walk away — belongs
 * to the parties' terms, and this wallet recommends none of them.
 */

export type PostureCase =
  | 'projection-unavailable'
  | 'projection-not-covered'
  | 'projection-unverified'
  /** The instant is final and the feed is current. */
  | 'settled-and-current'
  /** A change may still land, and the feed is current. */
  | 'expected-change-feed-current'
  /**
   * The feed is not current, whatever the projection says.
   *
   * Deliberately not folded into the case above. A stale feed means the
   * register may have stopped speaking, which is a different situation from a
   * register that is working through a backlog.
   */
  | 'feed-not-current'
  /** No feed is configured, so currency is unknown rather than good. */
  | 'no-feed-configured';

export type PostureView = {
  readonly case: PostureCase;
  readonly label: string;
  readonly projection: string;
  readonly feed: string;
  readonly explanation: string;
  /** What the ERC's non-normative reference pattern does here. Not advice. */
  readonly referencePattern: string;
  readonly boundary: string;
};

const BOUNDARY =
  'Reported, not recommended. This wallet holds no consideration, releases ' +
  'nothing and refunds nothing. Which of these cases warrants which action is ' +
  'a risk decision belonging to the parties’ terms.';

const LABELS: Record<PostureCase, string> = {
  'projection-unavailable': 'Projection answer unavailable',
  'projection-not-covered': 'Projection does not cover this instant',
  'projection-unverified': 'Projection interval not verified',
  'settled-and-current': 'Settled, feed current',
  'expected-change-feed-current': 'Change expected, feed current',
  'feed-not-current': 'Feed not current',
  'no-feed-configured': 'No feed configured',
};

const REFERENCE: Record<PostureCase, string> = {
  'projection-unavailable': 'No projection-based action follows from an unavailable answer.',
  'projection-not-covered': 'No projection-based action follows from an uncovered instant.',
  'projection-unverified': 'No projection-based action follows from unverified or inconsistent observations.',
  'settled-and-current':
    'The reference pattern circulating in the ERC’s discussion releases held ' +
    'consideration at this point.',
  'expected-change-feed-current':
    'A gap or freshness classification does not authorize payment release or refund. ' +
    'Any action requires the independent accepted conditions and verified execution evidence.',
  'feed-not-current':
    'The reference pattern treats this as its own case, separate from an ordinary ' +
    'pending change, precisely so a register that has gone quiet is not handled as ' +
    'one that is merely busy.',
  'no-feed-configured':
    'The reference pattern assumes a feed. Without one there is no currency signal ' +
    'to compose with, and the projection stands on its own.',
};

export function describePosture(finality: FinalityView, freshness: FreshnessView): PostureView {
  const feedStale = freshness.display === 'stale' || freshness.display === 'unknown';
  const noFeed = freshness.display === 'not-configured';

  const { reported, firstEffectiveAt: first, latestEffectiveAt: latest, instant } = finality;
  // Compare supplied evidence only to assess consistency. Never replace the
  // contract's reported answer or obtain a projection answer from feed freshness.
  const unavailable = reported === undefined || finality.display === 'unavailable';
  const unverified = first === undefined || latest === undefined || first > latest ||
    reported !== (instant >= first && instant < latest);
  const postureCase: PostureCase = unavailable ? 'projection-unavailable'
    : unverified ? 'projection-unverified'
    : finality.display === 'not-covered' ? 'projection-not-covered'
    : noFeed ? 'no-feed-configured'
    : feedStale ? 'feed-not-current'
    : finality.display === 'final' ? 'settled-and-current'
    : 'expected-change-feed-current';

  return {
    case: postureCase,
    label: LABELS[postureCase],
    projection: `${finality.label} — ${finality.explanation}`,
    feed: `${freshness.label} — ${freshness.explanation}`,
    explanation: explain(postureCase),
    referencePattern: REFERENCE[postureCase],
    boundary: BOUNDARY,
  };
}

function explain(postureCase: PostureCase): string {
  switch (postureCase) {
    case 'projection-unavailable':
      return 'No projection finality answer was obtained. Feed freshness is reported separately and supplies no missing answer.';
    case 'projection-not-covered':
      return 'The projection does not cover this instant. This is not an ordinary pending change; feed freshness cannot supply coverage.';
    case 'projection-unverified':
      return 'The reported projection answer is retained, but its boundaries are missing or inconsistent. Feed freshness cannot verify that interval.';
    case 'settled-and-current':
      return (
        'No later admission can change the holder at this instant, and the attestation ' +
        'feed is current. Note that "final" here is the projection’s answer no longer ' +
        'being able to change — it is not a statement about legal title.'
      );
    case 'expected-change-feed-current':
      return (
        'A later admission may still change the holder at this instant, and the feed is ' +
        'current, so the register is being heard from. This is ordinary catching up.'
      );
    case 'feed-not-current':
      return (
        'The attestation feed is not current, so the register may have stopped speaking ' +
        'rather than be working through a backlog. This is reported separately from an ' +
        'expected change on purpose: the two look alike and are not alike. It says ' +
        'nothing about whether the instant is final — read that separately.'
      );
    case 'no-feed-configured':
      return (
        'No attestation feed is configured, so whether the register is still speaking is ' +
        'unknown here. Unknown is not the same as current.'
      );
  }
}
