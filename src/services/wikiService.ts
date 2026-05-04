// src/services/wikiService.ts
import { createWiki } from '@equationalapplications/expo-llm-wiki'
import type { SQLiteDatabase } from 'expo-sqlite'
import { createWikiLlmProvider } from './wikiLlmProvider'

type Wiki = ReturnType<typeof createWiki>

let _wiki: Wiki | null = null

export function setupWiki(db: SQLiteDatabase): Wiki {
  if (_wiki) return _wiki
  _wiki = createWiki(db, {
    llmProvider: createWikiLlmProvider(),
    config: {
      tablePrefix: 'llm_wiki_',
      autoLibrarianThreshold: 20,
    },
  })
  return _wiki
}

export function getWiki(): Wiki | null {
  return _wiki
}

export async function initWiki(db: SQLiteDatabase): Promise<void> {
  const wiki = setupWiki(db)
  await wiki.setup()
}

/** For tests only — reset the singleton between test runs. */
export function _resetWikiForTests(): void {
  _wiki = null
}
