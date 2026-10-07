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

  const onPressExportGuide = async () => {
    if (Platform.OS === 'web') {
      window.location.assign('/memory-export-with-okf')
      return
    }

    await Linking.openURL('https://equationalapplications.com/memory-export-with-okf')
  }

  const onPressRealTimeVoice = async () => {
    if (Platform.OS === 'web') {
      window.location.assign('/real-time-voice')
      return
    }

    await Linking.openURL('https://clanker-ai.com/real-time-voice')
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text variant="headlineMedium" style={styles.title}>
        Clanker Support
      </Text>
      <Text variant="bodyMedium" style={styles.subtitle}>
        Need help with your account, Power, or subscription? Contact our support team and we will
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
            How does Power work?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Power is what you use in Clanker. Chat replies, image generation, live voice, cloud
            character saves/sync, document ingestion, and memory writes/heals all use Power. The
            Power meter at the top of the app shows how much you have left. The monthly plan refills
            your Power every billing cycle, and one-time packs add Power that lasts 31 days.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            How do I get more Power?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Two options:
            {'\n'}• Monthly plan ($20/month): 30,000 Power, refills automatically every billing
            cycle
            {'\n'}• One-time pack ($10): 10,000 Power, valid for 31 days
            {'\n'}Purchase from the Subscribe screen in the app.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            Does Power expire?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            • Free signup Power (5,000): never expires
            {'\n'}• Monthly plan Power: expires at the end of each billing cycle, when it refills
            {'\n'}• One-time pack Power: expires 31 days after purchase
            {'\n'}Your current Power is shown on the Subscribe screen.
          </Text>

          <Text variant="titleSmall" style={styles.question}>
            What happened to the unlimited plan?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            The unlimited plan has been retired. Monthly subscribers now receive 30,000 Power per
            billing cycle. Your existing Power is unaffected.
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How much Power does each action use?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            A text chat reply in the Chat tab uses 100–300 Power. Live real-time voice in the Talk
            tab uses 500 Power to connect plus 500 Power per minute. Generating an image uses 200
            Power, converting a document uses 200 Power, and each agent turn uses 100 Power per
            loop.{' '}
            <Text style={styles.inlineLink} onPress={onPressRealTimeVoice}>
              See how live voice works in action
            </Text>
            .
          </Text>

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            How do I sign in?
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            Open Clanker and choose Google or Apple sign-in. Use the same provider each time so your
            account data loads correctly.
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

          <Divider style={styles.divider} />

          <Text variant="titleSmall" style={styles.question}>
            {"Can I export my character's memory?"}
          </Text>
          <Text variant="bodyMedium" style={styles.bodyText}>
            {'Yes - open Character Settings and tap "Export Memory as OKF" to download a '}
            complete, standard-format backup of everything your character knows, including its
            facts, tasks, and how they connect. Bring it back anytime with{' '}
            {'"Import OKF Backup" (restore into the same character) or "From Bundle" on the '}
            characters list (clone into a new one). Restoring the same backup more than once
            {" won't duplicate your character's timeline."}
          </Text>
          <Button mode="text" onPress={onPressExportGuide} icon="open-in-new">
            Data export guide
          </Button>
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
  inlineLink: {
    textDecorationLine: 'underline',
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
