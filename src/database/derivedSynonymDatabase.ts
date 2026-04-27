export interface DerivedSynonymRow {
  term: string
  synonyms: string[]
}

export async function getDerivedSynonyms(
  _characterId: string,
): Promise<DerivedSynonymRow[]> {
  return []
}