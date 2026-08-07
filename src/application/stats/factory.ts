/**
 * The stats use cases, built from one set of dependencies. Wiring only.
 */
import { type GetLoginStats, type GetLoginStatsDeps, makeGetLoginStats } from './login-stats.ts';

export type StatsUseCases = {
  readonly loginStats: GetLoginStats;
};

export function makeStatsUseCases(deps: GetLoginStatsDeps): StatsUseCases {
  return { loginStats: makeGetLoginStats(deps) };
}
