export function canSubmitAdminConfirmation(input: {
  confirmKeyword?: string
  typedKeyword: string
  requireReason: boolean
  reason: string
  loading: boolean
}) {
  const keywordMatched = !input.confirmKeyword || input.typedKeyword === input.confirmKeyword

  const reasonValid = !input.requireReason || input.reason.trim().length > 0

  return keywordMatched && reasonValid && !input.loading
}
