import React from 'react'
import { create, act } from 'react-test-renderer'

jest.mock('~/components/admin/renewalDateValidation', () => ({
  normalizeRenewalDateInput: (v: string) => v || null,
}))

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    View: ({ children, style }: any) => React.createElement('View', { style }, children),
  }
})

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    Card: Object.assign(
      ({ children, style }: any) => React.createElement('View', { style }, children),
      {
        Content: ({ children, style }: any) => React.createElement('View', { style }, children),
      }
    ),
    Button: ({ children, onPress, disabled }: any) =>
      React.createElement('Button', { onPress, disabled }, children),
    TextInput: ({ label, value, onChangeText, mode, accessibilityHint, keyboardType, placeholder, error }: any) =>
      React.createElement('TextInput', { label, value, onChangeText, mode, accessibilityHint, keyboardType, placeholder, error }),
    Menu: Object.assign(
      ({ children, visible, onDismiss, anchor }: any) => React.createElement('View', {}, anchor, children),
      {
        Item: ({ title, onPress }: any) => React.createElement('View', { onPress }, title),
      }
    ),
  }
})

import { UserActionPanel } from '~/components/admin/UserActionPanel'

const user = {
  userId: 'u1',
  email: 'test@example.com',
  currentCredits: 50,
  planTier: 'free' as const,
  planStatus: 'active' as const,
  createdAt: null,
  termsAcceptedAt: null,
  termsVersion: null,
}

const noop = () => {}

describe('UserActionPanel accessibility', () => {
  it('renewal date TextInput has accessibilityHint with ISO 8601 format guidance', () => {
    let tree: any
    act(() => {
      tree = create(
        <UserActionPanel
          user={user}
          onSetCredits={noop}
          onSetSubscription={noop}
          onClearTerms={noop}
          onResetUserState={noop}
          onDeleteUser={noop}
          isBusy={false}
        />
      )
    })

    const inputs = tree.root.findAllByType('TextInput')
    const renewalInput = inputs.find((input: any) => input.props.label?.includes('Renewal'))
    expect(renewalInput).toBeDefined()
    expect(renewalInput!.props.accessibilityHint).toContain('ISO 8601')
  })
})
