describe('checkoutChannel.web', () => {
  const originalBroadcastChannel = (globalThis as { BroadcastChannel?: typeof BroadcastChannel })
    .BroadcastChannel

  beforeEach(() => {
    jest.resetModules()
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  afterEach(() => {
    ;(globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel =
      originalBroadcastChannel
  })

  it('does not crash and self-dispatches when BroadcastChannel is absent', () => {
    ;(globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = undefined

    const { createCheckoutChannel } = require('~/utilities/checkoutChannel.web')
    const channel = createCheckoutChannel({ uid: 'user-a' })
    const received: string[] = []

    channel.subscribe((event: { type: string }) => {
      received.push(event.type)
    })

    expect(() => {
      channel.publish({
        type: 'CHECKOUT_STARTED',
        payload: {
          attemptId: 'attempt-1',
          productType: 'payg',
          status: 'pending',
          at: '2026-04-22T10:00:00.000Z',
          sourceTabId: 'tab-a',
          schemaVersion: 1,
        },
      })
    }).not.toThrow()

    expect(received).toEqual(['CHECKOUT_STARTED'])
    channel.close()
  })

  it('falls back gracefully when BroadcastChannel constructor throws', () => {
    ;(globalThis as { BroadcastChannel?: unknown }).BroadcastChannel = jest
      .fn()
      .mockImplementation(() => {
        throw new Error('blocked')
      })

    const { createCheckoutChannel } = require('~/utilities/checkoutChannel.web')
    const channel = createCheckoutChannel({ uid: 'user-a' })
    const handler = jest.fn()
    channel.subscribe(handler)

    channel.publish({
      type: 'CHECKOUT_CANCELLED',
      payload: {
        attemptId: 'attempt-2',
        productType: 'payg',
        status: 'cancelled',
        at: '2026-04-22T10:00:00.000Z',
        sourceTabId: 'tab-a',
        schemaVersion: 1,
      },
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHECKOUT_CANCELLED',
      }),
    )
    channel.close()
  })

  it('ignores unknown schemaVersion payloads silently', () => {
    ;(globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = undefined

    const { createCheckoutChannel } = require('~/utilities/checkoutChannel.web')
    const channel = createCheckoutChannel({ uid: 'user-a' })
    const handler = jest.fn()
    channel.subscribe(handler)

    channel.publish({
      type: 'CHECKOUT_SUCCEEDED',
      payload: {
        attemptId: 'attempt-3',
        productType: 'payg',
        status: 'succeeded',
        at: '2026-04-22T10:00:00.000Z',
        sourceTabId: 'tab-a',
        schemaVersion: 2,
      },
    })

    expect(handler).not.toHaveBeenCalled()
    channel.close()
  })

  it('rejects events with invalid status or invalid timestamp payloads', () => {
    ;(globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = undefined

    const { createCheckoutChannel } = require('~/utilities/checkoutChannel.web')
    const channel = createCheckoutChannel({ uid: 'user-a' })
    const handler = jest.fn()
    channel.subscribe(handler)

    channel.publish({
      type: 'CHECKOUT_STARTED',
      payload: {
        attemptId: 'attempt-invalid-status',
        productType: 'payg',
        status: 'bad-status',
        at: '2026-04-22T10:00:00.000Z',
        sourceTabId: 'tab-a',
        schemaVersion: 1,
      },
    })

    channel.publish({
      type: 'CHECKOUT_STARTED',
      payload: {
        attemptId: 'attempt-invalid-at',
        productType: 'payg',
        status: 'pending',
        at: 'invalid-date',
        sourceTabId: 'tab-a',
        schemaVersion: 1,
      },
    })

    expect(handler).not.toHaveBeenCalled()
    channel.close()
  })

  it('continues dispatch when one listener throws', () => {
    ;(globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = undefined

    const { createCheckoutChannel } = require('~/utilities/checkoutChannel.web')
    const channel = createCheckoutChannel({ uid: 'user-a' })

    channel.subscribe(() => {
      throw new Error('listener failure')
    })

    const secondListener = jest.fn()
    channel.subscribe(secondListener)

    expect(() => {
      channel.publish({
        type: 'CHECKOUT_STARTED',
        payload: {
          attemptId: 'attempt-4',
          productType: 'payg',
          status: 'pending',
          at: '2026-04-22T10:00:00.000Z',
          sourceTabId: 'tab-a',
          schemaVersion: 1,
        },
      })
    }).not.toThrow()

    expect(secondListener).toHaveBeenCalledTimes(1)
    expect(secondListener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'CHECKOUT_STARTED',
      }),
    )

    channel.close()
  })

  it('is safe to import under SSR with no window', () => {
    const originalWindow = (globalThis as { window?: Window }).window

    try {
      ;(globalThis as { window?: Window }).window = undefined
      jest.isolateModules(() => {
        expect(() => require('~/utilities/checkoutChannel.web')).not.toThrow()
      })
    } finally {
      ;(globalThis as { window?: Window }).window = originalWindow
    }
  })
})
