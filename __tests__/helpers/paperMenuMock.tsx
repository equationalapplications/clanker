/**
 * Shared `react-native-paper` `Menu` test double.
 *
 * Both composer suites mock `react-native-paper` wholesale and both need a
 * `Menu`, so the mock lives here rather than being copy-pasted with a
 * "keep in step" comment. `jest.mock` factories are hoisted above imports,
 * so callers must `require` this from inside the factory body.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import type * as ReactType from 'react'

/**
 * Build a `Menu` mock bound to the caller's React instance.
 *
 * The anchor is always rendered; items exist only while `visible`. Mirrors the
 * real component closely enough for tests, the same way
 * `Portal: ({ children }) => children` does.
 *
 * @param React - the `react` module the calling factory already required.
 * @param Text - the element type each `Menu.Item` renders as.
 * @param tagItems - when true, each item also carries `__attachMenuItemMock`
 *   set to its title, so render-tree (non-RNTL) lookups can find it by prop.
 */
export function createMenuMock(
  React: typeof ReactType,
  Text: any,
  { tagItems = false }: { tagItems?: boolean } = {},
) {
  return Object.assign(
    ({ anchor, visible, children }: any) =>
      React.createElement(React.Fragment, null, anchor, visible ? children : null),
    {
      Item: ({ title, onPress, disabled }: any) =>
        // Honour `disabled` with a no-op rather than `undefined`, same reason
        // as the Button mock: RNTL climbs to an ancestor handler when the
        // pressed element has none.
        React.createElement(
          Text,
          {
            ...(tagItems ? { __attachMenuItemMock: title } : {}),
            onPress: disabled ? () => {} : onPress,
            accessibilityLabel: title,
            accessibilityState: { disabled: !!disabled },
          },
          title,
        ),
    },
  )
}
