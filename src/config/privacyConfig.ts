// Privacy Policy Configuration
// Update this file when the privacy policy changes and increment the version

export interface PrivacyConfig {
  version: string
  privacy: string
  lastUpdated: string
}

export const PRIVACY: PrivacyConfig = {
  version: '1.9',
  lastUpdated: 'July 7, 2026',
  privacy: `
Equational Applications LLC ("we", "us", "our") is committed to protecting your privacy.
This privacy policy explains how we collect, use, and disclose information through our
Clanker app (the "App"). By using the App, you consent to our collection, use,
and disclosure of your information in accordance with this privacy policy.

Information We Collect
We may collect personal information from you when you use the App, including your name,
email address, and payment information. We may also collect information about your use of
the App, including the content you create, your device information, and your location.

How We Use Your Information
We may use your information to provide and improve the App, to respond to your inquiries
and requests, to communicate with you about the App, and to personalize your experience.
We may also use your information to analyze and improve the App, to comply with legal
obligations, and to protect our rights and property.

How We Share Your Information
We may share your information with third-party service providers who perform services on
our behalf, such as payment processing and data storage. We may also share your
information with our affiliates, as well as with law enforcement or other authorities if
we believe it is necessary to comply with a legal obligation or to protect our rights and
property.

AI Processing of Chat Content
When you use the chat feature, the content you submit — including your messages, character
descriptions and personas, and any attached images or files — is transmitted to Google
Vertex AI, operated by Google LLC, which generates responses on our behalf. Google
processes this content as our service provider under the Google Cloud Privacy Notice
(https://cloud.google.com/terms/cloud-privacy-notice) and does not use it to train its
foundation models. Please do not submit sensitive personal information (such as government
identifiers, financial account numbers, or health records) in chat.

Crash Reporting and Diagnostics

To ensure the stability and reliability of the App, we use Firebase Crashlytics, 
a crash reporting service provided by Google LLC. If the App crashes or encounters 
an error, Crashlytics automatically collects diagnostic information to help us identify, 
troubleshoot, and resolve the issue.

The information collected does not include your name or email, but may include your 
device's Internet Protocol (IP) address, hardware model, operating system version, 
a unique device installation identifier (UUID), and the state of the App at the time 
of the crash. This diagnostic data is transmitted to and stored by Google in 
accordance with the Google Privacy Policy.

Crash reporting is disabled by default. We rely on your explicit consent before 
collecting this diagnostic data. You can enable or disable crash reporting at any 
time within the App's settings.

Cookies and Similar Technologies (Web Only)

We use cookies and similar storage on the web app for the following purposes:

- Strictly necessary: required for sign-in, security, and core app functionality
  (e.g., Firebase Authentication session). These cannot be turned off.
- Preferences: may remember a UI choice you actively make, such as theme, so the
  app can apply that setting on future visits. Apart from such user-requested UI
  preferences, additional non-essential preference storage is off by default unless
  you enable the Preferences category.
- Analytics: helps us understand product usage to improve the app (off by default,
  requires explicit opt-in).
- Marketing: reserved for future advertising measurement (off by default,
  not currently active).

Legal basis: For visitors in the EU, EEA, UK, and Canada (including Quebec), we
rely on your explicit consent before setting non-essential cookies or similar
storage, except where storage is used to remember a setting you directly request.
You can accept, reject, or change your choices at any time using "Cookie
Preferences" in the landing page footer or in Settings on the web. Your consent is
stored locally for 12 months, after which we will ask again.

Third parties: When you start a Stripe checkout, you are redirected to Stripe
on stripe.com; cookies set during that flow are governed by Stripe's privacy
notice, not ours.

## Clanker Browser Extension Data Usage

The Clanker Chrome Extension acts as a secure bridge between your desktop browser
and the Clanker AI ecosystem. To comply with the Chrome Web Store User Data Policy,
we explicitly state the following:

**Single Purpose:** The sole purpose of the extension is to allow the Clanker AI
to read, summarize, and interact with the web pages you explicitly command it to.

**Data Collection:** The extension only extracts text, URLs, and DOM structure from
your active tab when a specific task is triggered (either via scheduled automation
or remote command). We do not passively track your browsing history or monitor
background tabs.

**Data Transmission:** Extracted page data is transmitted securely to our cloud
infrastructure strictly to process your AI prompt.

**Limited Use Disclosure:** The extension's use and transfer to any other app of
information received from Google APIs will adhere to the Chrome Web Store User Data
Policy, including the Limited Use requirements.

**No Data Sale:** We do not sell your browser data to third parties. Your data is
not used for advertising, creditworthiness, or lending purposes.

Payment Processing

We use Stripe, a third-party payment processor, to handle securely all payment 
transactions. When you make a purchase, you provide your payment details directly 
to Stripe. We do not collect, process, or store your full credit card numbers or 
bank account information on our servers.

The payment information you provide to Stripe is governed by Stripe's Privacy Policy 
(https://stripe.com/privacy). We only receive limited information from Stripe, such 
as payment confirmation, the last four digits of your card, and billing zip code, 
which we use solely to fulfill your order, prevent fraud, and maintain transaction 
records for tax and legal purposes.

Retention of Information
We may retain your information for as long as necessary to provide and improve the App, to
comply with legal obligations, and to protect our rights and property.

Security
We take reasonable measures to protect your information from unauthorized access, use, or
disclosure. However, no method of transmission over the Internet or electronic storage is
100% secure, so we cannot guarantee absolute security.

Changes to this Privacy Policy
We reserve the right to modify this privacy policy at any time, in our sole discretion.
Any changes will be effective immediately upon posting the revised privacy policy on the
App. Your continued use of the App following the posting of changes to this privacy policy
constitutes your acceptance of those changes.

Your Data Rights and Account Deletion

You have the right to access, update, or delete the personal information we hold 
about you.

How to request deletion: You can delete your account and associated personal data 
at any time directly within the App from the Profile page by using the Delete Account 
button. Alternatively, you can request data deletion by contacting us at
support@clanker.app.

What happens when you delete your account: Upon receiving a deletion request, we 
will promptly delete your account and personal data from our active databases. Please 
note that we may retain certain limited information (such as transaction records) for 
a period of time as required by law, for tax and accounting purposes, or to resolve 
disputes.

Data Portability
You can export your character's complete memory (facts, tasks, and interaction
history, including how they relate to each other) at any time from Character
Settings, in the Open Knowledge Format (OKF), an open standard. This self-serve
export contains everything associated with that character's memory. You retain
full control of your exported data. You can also bring an exported bundle back
in at any time — restoring it into the same character, or using it to create a
new one.

Contact Us
If you have any questions or concerns about this privacy policy, please contact us at
support@clanker.app.

Governing Law
This privacy policy shall be governed by and construed in accordance with the laws of the
State of Michigan without regard to its conflicts of law provisions.

By using the App, you acknowledge that you have read, understood, and agree to be bound by
this privacy policy. If you do not agree to this privacy policy, do not use the App.
`,
}
