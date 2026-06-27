export const LEGACY_SOURCE_TYPES = [
  "user_stated",
  "agent_inferred",
  "user_confirmed",
  "user_document",
] as const;

export const V4_SOURCE_TYPES = [
  "user_stated",
  "librarian_inferred",
  "user_confirmed",
  "immutable_document",
] as const;

export const VALID_SYNC_SOURCE_TYPES = new Set<string>([
  ...LEGACY_SOURCE_TYPES,
  ...V4_SOURCE_TYPES,
]);

/** Map client v4 source_type values to legacy Cloud SQL enum values. */
export function normalizeSourceTypeForStorage(
  sourceType: string | null | undefined,
): string {
  if (sourceType == null) return "agent_inferred";
  switch (sourceType) {
    case "librarian_inferred":
      return "agent_inferred";
    case "immutable_document":
      return "user_document";
    default:
      return sourceType;
  }
}

/** Map legacy Cloud SQL source_type values to client v4 enum values. */
export function normalizeSourceTypeForExport(
  sourceType: string | null | undefined,
): string | null {
  if (sourceType == null) return null;
  switch (sourceType) {
    case "agent_inferred":
      return "librarian_inferred";
    case "user_document":
      return "immutable_document";
    default:
      return sourceType;
  }
}
