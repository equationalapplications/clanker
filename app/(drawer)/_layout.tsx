import { DrawerActions, useNavigation } from '@react-navigation/native'
import { router } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { useTheme, Icon } from 'react-native-paper'
import { Pressable } from 'react-native'
import { useSelector } from '@xstate/react'
import { useTermsMachine } from '~/hooks/useMachines'
import LoadingIndicator from '~/components/LoadingIndicator'
import React from 'react'

function DrawerToggleButton({ tintColor }: { tintColor?: string }) {
  const navigation = useNavigation()
  return (
    <Pressable
      onPress={() => navigation.dispatch(DrawerActions.toggleDrawer())}
      style={{ marginLeft: 6, padding: 10 }}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel="Toggle navigation drawer"
    >
      <Icon source="menu" color={tintColor} size={24} />
    </Pressable>
  )
}

const AppLayout = () => {
  const theme = useTheme()
  const termsService = useTermsMachine()
  const { termsAccepted, termsBlocking, termsLoading, isUpdate } = useSelector(
    termsService,
    (state) => ({
      termsAccepted: state.matches('accepted'),
      termsBlocking: state.matches('acceptanceRequired'),
      termsLoading: state.matches('idle') || state.matches('checking'),
      isUpdate: state.context.isUpdate,
    }),
  )

  React.useEffect(() => {
    if (termsBlocking) {
      router.replace({
        pathname: '/accept-terms',
        params: { isUpdate: isUpdate.toString() },
      })
    }
  }, [termsBlocking, isUpdate])

  if (termsLoading) {
    return <LoadingIndicator disabled={false} />
  }

  if (!termsAccepted) {
    return null
  }

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
        headerLeft: ({ tintColor }) => <DrawerToggleButton tintColor={tintColor} />,
      }}
    >
      <Drawer.Screen
        name="(tabs)"
        options={{
          drawerLabel: 'Chat',
          title: 'Chat',
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
