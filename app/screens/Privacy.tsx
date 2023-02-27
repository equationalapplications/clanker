import { StyleSheet, ScrollView } from "react-native"

import { ParagraphText } from "../components/StyledText"
import { Text, View } from "../components/Themed"

export default function Privacy() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Privacy Policy</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <ScrollView contentContainerStyle={styles.scrollView}>
        <ParagraphText style={styles.paragraph}>
          Equational Applications LLC ("we", "us", "our") is committed to protecting your privacy.
          This privacy policy explains how we collect, use, and disclose information through our
          Yours Brightly AI app (the "App"). By using the App, you consent to our collection, use,
          and disclosure of your information in accordance with this privacy policy.
          {"\n\n"}
          Information We Collect
          {"\n"}
          We may collect personal information from you when you use the App, including your name,
          email address, and payment information. We may also collect information about your use of
          the App, including the content you create, your device information, and your location.
          {"\n\n"}
          How We Use Your Information
          {"\n"}
          We may use your information to provide and improve the App, to respond to your inquiries
          and requests, to communicate with you about the App, and to personalize your experience.
          We may also use your information to analyze and improve the App, to comply with legal
          obligations, and to protect our rights and property.
          {"\n\n"}
          How We Share Your Information
          {"\n"}
          We may share your information with third-party service providers who perform services on
          our behalf, such as payment processing and data storage. We may also share your
          information with our affiliates, as well as with law enforcement or other authorities if
          we believe it is necessary to comply with a legal obligation or to protect our rights and
          property.
          {"\n\n"}
          Retention of Information
          {"\n"}
          We may retain your information for as long as necessary to provide and improve the App, to
          comply with legal obligations, and to protect our rights and property.
          {"\n\n"}
          Security
          {"\n"}
          We take reasonable measures to protect your information from unauthorized access, use, or
          disclosure. However, no method of transmission over the Internet or electronic storage is
          100% secure, so we cannot guarantee absolute security.
          {"\n\n"}
          Changes to this Privacy Policy
          {"\n"}
          We reserve the right to modify this privacy policy at any time, in our sole discretion.
          Any changes will be effective immediately upon posting the revised privacy policy on the
          App. Your continued use of the App following the posting of changes to this privacy policy
          constitutes your acceptance of those changes.
          {"\n\n"}
          Contact Us
          {"\n"}
          If you have any questions or concerns about this privacy policy, please contact us at
          info@equationalapplications.com.
          {"\n\n"}
          Governing Law
          {"\n"}
          This privacy policy shall be governed by and construed in accordance with the laws of the
          State of Michigan without regard to its conflicts of law provisions.
          {"\n\n"}
          By using the App, you acknowledge that you have read, understood, and agree to be bound by
          this privacy policy. If you do not agree to this privacy policy, do not use the App.
        </ParagraphText>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  scrollView: {
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: 30,
    fontSize: 20,
    fontWeight: "bold",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
  paragraph: {
    width: "60%",
  },
})
