import { DrawerActions, useNavigation } from '@react-navigation/native'
import { router } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { useTheme, Icon } from 'react-native-paper'
import { Pressable } from 'react-native'
import { useSelector } from '@xstate/react'
import { useTermsMachine } from '~/hooks/useMachines'
import React from 'react'
import { StateFrom } from 'xstate'
import { termsMachine } from '~/machines/termsMachine'

const AppLayout = () => {
  const theme = useTheme()
  const navigation = useNavigation()
  const termsService = useTermsMachine()
  useSelector(
    termsService,
    (state) => ({
      needsTermsAcceptance: state.matches('acceptanceRequired'),
      isUpdate: state.context.isUpdate,
    }),
  )

  React.useEffect(() => {
    const sub = termsService.subscribe((state: StateFrom<typeof termsMachine>) => {
      if (state.matches('acceptanceRequired')) {
        router.push({
          pathname: '/terms',
          params: { isUpdate: state.context.isUpdate.toString() },
        })
      }
    })
    return sub.unsubscribe
  }, [termsService])

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
        headerLeft: ({ tintColor }) => (
          <Pressable
            onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
            style={{ marginLeft: 6, padding: 10 }}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Toggle navigation drawer"
          >
            <Icon source="menu" color={tintColor} size={24} />
          </Pressable>
        ),
      }}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerLabel: 'Chats',
          title: 'Chats',
          drawerIcon: ({ color, size }) => <Icon source="chat" color={color} size={size} />,
        }}
      />
      <Drawer.Screen
        name="profile"
        options={{
          drawerLabel: 'Profile',
          title: 'Profile',
          drawerIcon: ({ color, size }) => (
            <Icon source="account-circle" color={color} size={size} />
          ),
        }}
      />
      <Drawer.Screen
        name="settings"
        options={{
          drawerLabel: 'Settings',
          title: 'Settings',
          drawerIcon: ({ color, size }) => <Icon source="cog" color={color} size={size} />,
        }}
      />
      <Drawer.Screen
        name="accept-terms"
        options={{
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="subscribe"
        options={{
          drawerLabel: 'Subscribe',
          title: 'Subscribe',
          drawerIcon: ({ color, size }) => <Icon source="account-plus" color={color} size={size} />,
        }}
      />
    </Drawer>
  )
}

export default AppLayout
