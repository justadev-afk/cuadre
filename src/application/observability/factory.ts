/**
 * The observability use cases, built from one dependency: the source that reads
 * the attempt dataset — or `null` when this environment has no SQL API token,
 * which the use case turns into an `unconfigured` view rather than a failure.
 *
 * Wiring only, like every other `factory.ts`. The container decides whether a
 * real source exists; this file just fits it to the port the use case declared.
 */
import {
  type AttemptInsightsSource,
  type GetAttemptInsights,
  makeGetAttemptInsights,
} from './attempt-insights.ts';

export type ObservabilityDeps = {
  readonly source: AttemptInsightsSource | null;
};

export type ObservabilityUseCases = {
  readonly attemptInsights: GetAttemptInsights;
};

export function makeObservabilityUseCases(deps: ObservabilityDeps): ObservabilityUseCases {
  return {
    attemptInsights: makeGetAttemptInsights(deps),
  };
}
