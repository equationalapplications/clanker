import { DrawerActions, useNavigation } from '@react-navigation/native'
import { DrawerContentScrollView, DrawerItem, DrawerItemList } from '@react-navigation/drawer'
import { router, usePathname, type Href } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { useTheme, Icon } from 'react-native-paper'
import { Pressable } from 'react-native'
import { useSelector } from '@xstate/react'
import { useTermsMachine } from '~/hooks/useMachines'
import LoadingIndicator from '~/components/LoadingIndicator'
import React from 'react'

const DRAWER_ROUTE_CONFIG: Record<string, { label: string; icon: string }> = {
  '(tabs)': { label: 'Chat', icon: 'chat' },
  profile: { label: 'Profile', icon: 'account-circle' },
  settings: { label: 'Settings', icon: 'cog' },
  subscribe: { label: 'Subscribe', icon: 'crown' },
}

const HIDDEN_DRAWER_SCREEN_OPTIONS = {
  headerShown: false,
  drawerItemStyle: { display: 'none' as const },
}

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
  const pathname = usePathname()
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
    if (termsBlocking && pathname !== '/accept-terms') {
      router.replace({
        pathname: '/accept-terms',
        params: { isUpdate: isUpdate.toString() },
      })
    }
  }, [termsBlocking, isUpdate, pathname])

  if (termsLoading) {
    return <LoadingIndicator disabled={false} />
  }

  return (
    <Drawer
      drawerContent={(props) => (
        <DrawerContentScrollView {...props}>
          <DrawerItemList {...props} />
          {termsAccepted ? (
            <DrawerItem
              label="Support"
              icon={({ color, size }) => <Icon source="lifebuoy" color={color} size={size} />}
              onPress={() => router.push('/support' as Href)}
            />
          ) : null}
        </DrawerContentScrollView>
      )}
      screenOptions={({ route }) => ({
        ...(() => {
          const routeConfig = DRAWER_ROUTE_CONFIG[route.name]
          if (!routeConfig) {
            return {}
          }

          return {
            drawerLabel: routeConfig.label,
            title: routeConfig.label,
            headerTitle: routeConfig.label,
            drawerIcon: ({ color, size }: { color: string; size: number }) => (
              <Icon source={routeConfig.icon} color={color} size={size} />
            ),
          }
        })(),
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
        headerLeft: ({ tintColor }) => <DrawerToggleButton tintColor={tintColor} />,
      })}
    >
      <Drawer.Screen name="(tabs)" options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS} />
      <Drawer.Screen
        name="profile"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="settings"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
      <Drawer.Screen
        name="accept-terms"
        options={{
          headerShown: false,
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="subscribe"
        options={termsAccepted ? undefined : HIDDEN_DRAWER_SCREEN_OPTIONS}
      />
    </Drawer>
  )
}

export default AppLayout
