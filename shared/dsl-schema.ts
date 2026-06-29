import { z } from 'zod'
import type { SingleAction } from './dsl-types.js'

const singleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_tab'), url: z.string().url() }),
  z.object({ type: z.literal('focus_tab'), host: z.string().min(1) }),
  z.object({ type: z.literal('extract'), selector: z.string().min(1), label: z.string().optional() }),
  z.object({ type: z.literal('summarize_visible_text'), filter: z.enum(['no_nav', 'no_ads', 'all']).optional() }),
  z.object({ type: z.literal('read_dom'), selector: z.string().min(1) }),
  z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), pixels: z.number().int().positive().optional() }),
  z.object({ type: z.literal('fill_field'), selector: z.string().min(1), value: z.string(), tier: z.literal('stateful') }),
  z.object({ type: z.literal('click'), selector: z.string().min(1), label: z.string().optional(), tier: z.literal('stateful') }),
])

const sequenceActionSchema = z.object({
  type: z.literal('sequence'),
  steps: z.array(singleActionSchema).min(1), // singleActionSchema has no 'sequence' member → nesting rejected
})

export const taskIntentSchema = z.object({
  version: z.literal('1'),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  requiresAuth: z.boolean(),
  actionSummary: z.string(),
  action: z.union([singleActionSchema, sequenceActionSchema]),
})

export type ValidatedTaskIntent = z.infer<typeof taskIntentSchema>

export function validateTaskIntent(input: unknown): ValidatedTaskIntent {
  return taskIntentSchema.parse(input)
}

const READ_ONLY = new Set(['extract', 'summarize_visible_text', 'read_dom'])
const NAVIGATION = new Set(['open_tab', 'focus_tab', 'scroll'])

export function actionTier(action: SingleAction): 'read_only' | 'navigation' | 'stateful' {
  if (READ_ONLY.has(action.type)) return 'read_only'
  if (NAVIGATION.has(action.type)) return 'navigation'
  return 'stateful'
}
