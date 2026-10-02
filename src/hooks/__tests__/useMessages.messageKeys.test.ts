import { messageKeys } from '../useMessages'

/**
 * Guards the key factory that `useProactiveSync` invalidates against. Its own
 * test stubs `~/hooks/useMessages` (the real module pulls in the SQLite stack),
 * so without this the stub could drift from the real keys and a mis-scoped
 * invalidation would still look green.
 */
describe('messageKeys', () => {
  it('nests every level under the previous one', () => {
    expect(messageKeys.all).toEqual(['messages'])
    expect(messageKeys.lists()).toEqual(['messages', 'list'])
    expect(messageKeys.character('char-1')).toEqual(['messages', 'list', 'char-1'])
    expect(messageKeys.list('char-1', 'uid-1')).toEqual(['messages', 'list', 'char-1', 'uid-1'])
  })

  it('scopes a character key to that character only', () => {
    const key = messageKeys.character('char-1')
    const other = messageKeys.list('char-2', 'uid-1')
    expect(other.slice(0, key.length)).not.toEqual(key)
    expect(messageKeys.list('char-1', 'uid-1').slice(0, key.length)).toEqual(key)
  })
})
