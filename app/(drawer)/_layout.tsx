import { router } from 'expo-router'
import { Drawer } from 'expo-router/drawer'
import { useEffect } from 'react'
import { useTheme, Icon } from 'react-native-paper'
import { useSubscriptionStatus } from '~/hooks/useSubscriptionStatus'

export default function DrawerLayout() {
  const theme = useTheme()
  const { needsTermsAcceptance, isUpdate, isLoading } = useSubscriptionStatus()

  useEffect(() => {
    console.log(
      '[AppLayout] useEffect triggered - isLoading:',
      isLoading,
      'needsTermsAcceptance:',
      needsTermsAcceptance,
    )
    if (!isLoading && needsTermsAcceptance) {
      console.log('[AppLayout] Redirecting to accept-terms')
      router.replace({
        pathname: '/accept-terms',
        params: { isUpdate: isUpdate.toString() },
      })
    }
  }, [isLoading, needsTermsAcceptance, isUpdate])

  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.primary,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
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
