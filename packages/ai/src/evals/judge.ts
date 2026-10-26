import { z } from 'zod';
import type { LlmGateway } from '../gateway/gateway';
import type { ModelRef } from '../gateway/types';
import { DEFAULT_TONE_GUIDE } from '../prompts/shared';
import { extractJsonObject } from '../text/json';

export const JUDGE_PROMPT_VERSION = 'judge.v1';

const JudgeSchema = z.object({
  acknowledges: z.number().min(1).max(5),
  specific: z.number().min(1).max(5),
  policyAccurate: z.number().min(1).max(5),
  ownership: z.number().min(1).max(5),
  timeline: z.number().min(1).max(5),
  nextStep: z.number().min(1).max(5),
  overall: z.number().min(1).max(5),
  notes: z.string(),
});
export type JudgeScores = z.infer<typeof JudgeSchema>;

const criterion = { type: 'integer', minimum: 1, maximum: 5 };

/** LLM-as-judge for draft quality, scored against BookLeaf's own tone guide and expected handling. */
export async function judgeReply(
  gateway: LlmGateway,
  route: ModelRef[],
  input: { query: string; guidance: string; facts: string; reply: string },
): Promise<JudgeScores | null> {
  try {
    const run = await gateway.run({
      task: 'judge',
      route,
      request: {
        system: `You are an exacting reviewer of author-support replies for BookLeaf Publishing, a self-publishing company. Score the reply from 1 (poor) to 5 (excellent) on each criterion. Be strict: 5 means a senior specialist would send it unchanged.

<tone_guidelines>
${DEFAULT_TONE_GUIDE}
</tone_guidelines>

Criteria:
acknowledges — acknowledges the author's specific concern before solutions.
specific — uses exact numbers, dates and statuses instead of vague reassurance.
policyAccurate — everything stated matches the facts and BookLeaf policy; nothing invented.
ownership — owns BookLeaf's mistakes directly when relevant (score 5 if not applicable).
timeline — gives a concrete timeline where escalation or investigation is needed (5 if not applicable).
nextStep — ends with a clear next step.
overall — overall quality as a BookLeaf reply.
Return only JSON.`,
        messages: [
          {
            role: 'user',
            content: `<author_query>\n${input.query}\n</author_query>\n\n<expected_handling>\n${input.guidance}\n</expected_handling>\n\n<facts>\n${input.facts}\n</facts>\n\n<reply>\n${input.reply}\n</reply>`,
          },
        ],
        schema: {
          name: 'judge',
          jsonSchema: {
            type: 'object',
            properties: {
              acknowledges: criterion,
              specific: criterion,
              policyAccurate: criterion,
              ownership: criterion,
              timeline: criterion,
              nextStep: criterion,
              overall: criterion,
              notes: { type: 'string' },
            },
            required: [
              'acknowledges',
              'specific',
              'policyAccurate',
              'ownership',
              'timeline',
              'nextStep',
              'overall',
              'notes',
            ],
            additionalProperties: false,
          },
        },
        maxOutputTokens: 1500,
        temperature: 0,
      },
      parse: (text) => JudgeSchema.parse(extractJsonObject(text)),
      timeoutMs: 45_000,
      promptVersion: JUDGE_PROMPT_VERSION,
    });
    return run.value;
  } catch {
    return null;
  }
}
