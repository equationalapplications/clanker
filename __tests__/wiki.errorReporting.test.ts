import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'

jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))

describe('wiki error reporting', () => {
  test('WikiBusyError is not reported', () => {
    const { reportError } = require('~/utilities/reportError')
    const err = new WikiBusyError('ingest', 'entity-1')
    if (!(err instanceof WikiBusyError)) reportError(err, 'wiki:test')
    expect(reportError).not.toHaveBeenCalled()
  })

  test('non-busy error is reported with context tag', () => {
    const { reportError } = require('~/utilities/reportError')
    ;(reportError as jest.Mock).mockClear()
    const err = new Error('disk full')
    if (!(err instanceof WikiBusyError)) reportError(err, 'wiki:test')
    expect(reportError).toHaveBeenCalledWith(err, 'wiki:test')
  })
})
