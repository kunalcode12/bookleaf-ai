import type { LlmTask } from '../config';
import type { LlmGateway } from '../gateway/gateway';
import type { ModelRef } from '../gateway/types';

/** What every pipeline needs; assembled once by createLeaf(). */
export interface PipelineDeps {
  gateway: LlmGateway;
  routes: Record<LlmTask, ModelRef[]>;
  timeouts: Record<LlmTask, number>;
  now: () => Date;
  allowedLinkDomains: readonly string[];
}
