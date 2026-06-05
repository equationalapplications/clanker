// shared/wiki-utils.ts
export function clip(value: string, maxLength: number): string {
  const normalized = value.trim()
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength).trimEnd()
}

export function inferTags(summary: string): string[] {
  const lowered = summary.toLowerCase()
  const tags: string[] = []
  if (lowered.includes('health') || lowered.includes('workout') || lowered.includes('run')) tags.push('health')
  if (lowered.includes('work') || lowered.includes('job') || lowered.includes('deadline')) tags.push('work')
  if (lowered.includes('partner') || lowered.includes('friend') || lowered.includes('family')) tags.push('relationships')
  if (lowered.includes('goal') || lowered.includes('plan') || lowered.includes('next')) tags.push('goals')
  return tags.slice(0, 3)
}