import { Linking, Platform, ScrollView, StyleSheet, View } from 'react-native'
import { Button, Card, Divider, Text } from 'react-native-paper'

const SUPPORT_EMAIL = 'info@equationalapplications.com'

export default function Support() {
  const onPressEmail = async () => {
    const mailtoUrl = `mailto:${SUPPORT_EMAIL}`

    if (Platform.OS === 'web') {
      // Use same-tab navigation on web to avoid opening an empty about:blank tab.
      window.location.assign(mailtoUrl)
      return
    }

    await Linking.openURL(mailtoUrl)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="headlineMedium" style={styles.title}>
        Clanker Support
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Need help with your account, credits, or subscription? Contact our support team and we will
        respond as quickly as possible.
      </Text>

      <Card mode="contained" style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Contact Support
          </Text>
          <Text variant="bodyMedium" style={[styles.bodyText, styles.contactEmailText]}>
            Email us at {SUPPORT_EMAIL}
          </Text>
          <Button mode="contained" onPress={onPressEmail} icon="email">
            Email Support
          </Button>
        </Card.Content>
      </Card>

      <Card mode="contained" style={styles.card}>
        <Card.Content>
          <Text variant="titleMedium" style={styles.sectionTitle}>
            Frequently Asked Questions
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            How do credits and subscriptions work?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Chat replies, image generation, voice replies, cloud character saves/sync, document ingestion, and memory writes/heals consume credits. Subscriptions give a monthly credit allowance, and one-time packs
            grant temporary credits that expire after 31 days.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            How do I get more credits?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Two options:
            {'\n'}• Monthly subscription ($20/month): 300 credits per billing cycle, renewed automatically
            {'\n'}• One-time pack ($10): 100 credits, valid for 31 days
            {'\n'}Purchase from the Subscribe screen in the app.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            Do credits expire?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            • Free signup credits (50 credits): never expire
            {'\n'}• Monthly subscription credits: expire at the end of each billing cycle
            {'\n'}• One-time credit pack credits: expire 31 days after purchase
            {'\n'}Your credit balance and next expiry date are shown in the Credits section.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            What happened to unlimited credits?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            The unlimited credits plan has been retired. Monthly subscribers now receive
            300 credits per billing cycle. Your existing credits remain unaffected.
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How do voice replies work and what do they cost?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Open the Talk tab, tap the mic, and speak. Your character replies out loud in their
            chosen voice. Voice replies cost 2 credits per reply, regardless of whether you are
            on a monthly plan or using one-time credits.
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How do I sign in?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Open Clanker and choose Google or Apple sign-in. Use the same provider each time so
            your account data loads correctly.
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How do I delete my account?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            You can delete your account yourself from the Profile page by using the Delete Account
            button.
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How do I get help quickly?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Send a message to {SUPPORT_EMAIL} with your device type, app version, and a short
            description of the issue.
          </Text>
        </Card.Content>
      </Card>
      <View style={styles.footerSpacing} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    maxWidth: 880,
    width: '100%',
    alignSelf: 'center',
  },
  title: {
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 16,
  },
  card: {
    marginBottom: 12,
  },
  sectionTitle: {
    marginBottom: 10,
    fontWeight: '600',
  },
  question: {
    marginTop: 2,
    marginBottom: 6,
    fontWeight: '600',
  },
  bodyText: {
    lineHeight: 20,
  },
  contactEmailText: {
    marginBottom: 12,
  },
  divider: {
    marginVertical: 12,
  },
  footerSpacing: {
    height: 20,
  },
})