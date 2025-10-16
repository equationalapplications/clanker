# Clanker

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-blue.svg)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-54-000020.svg)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> An AI chatbot Expo app with multi-tenant Firebase + Supabase architecture. Users create custom characters and chat with them using Vertex AI, with subscription-based access control.

## 🚀 Features

- **AI Character Creation**: Create and customize AI characters with unique personalities, appearances, and traits
- **Real-time Chat**: Powered by Google Cloud Vertex AI with conversation history and context awareness
- **Multi-tenant Architecture**: Firebase Authentication with Supabase backend and Row-Level Security (RLS)
- **Subscription Management**: Free tier with credits, multiple paid tiers via RevenueCat and Stripe
- **Cross-platform**: iOS, Android, and Web support with React Native and Expo
- **Offline Support**: Built-in offline capabilities with React Query
- **Real-time Sync**: Live message updates with Supabase real-time subscriptions

## 📋 Prerequisites

- Node.js 18 or later
- npm 9 or later
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (Mac only) or Android Studio for mobile development
- Firebase project with Authentication enabled
- Supabase project with database and storage configured
- Google Cloud project with Vertex AI API enabled
- RevenueCat account for subscription management (optional for development)

## 🛠️ Quick Start

1. **Clone the repository**

```bash
git clone https://github.com/equationalapplications/yoursbrightlyai.git
cd yoursbrightlyai
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
```

Edit `.env` and fill in your Firebase, Supabase, and other service credentials:

```env
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_project.appspot.com
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id

SUPABASE_URL=https://your_project.supabase.co
SUPABASE_ANON_KEY=your_supabase_anon_key

GOOGLE_WEB_CLIENT_ID=your_google_web_client_id
GOOGLE_ANDROID_CLIENT_ID=your_google_android_client_id
GOOGLE_IOS_CLIENT_ID=your_google_ios_client_id
```

4. **Configure Firebase**

Download your Firebase configuration files:
- `google-services.json` for Android (place in project root)
- `GoogleService-Info.plist` for iOS (place in project root)

**Note**: These files are gitignored and should never be committed to the repository.

5. **Start the development server**

```bash
npm start
```

Then press:
- `i` for iOS simulator
- `a` for Android emulator
- `w` for web browser

## 📱 Available Scripts

```bash
npm start              # Start with dev client
npm run android        # Run on Android device
npm run ios            # Run on iOS device
npm run web            # Run in browser
npm run start:clear    # Start with cleared cache

npm run lint           # Run ESLint
npm run lint:check     # Check linting without fixing
npm run typecheck      # Run TypeScript type checking
npm run format         # Format code with Prettier

npm test               # Run tests
npm run test:watch     # Run tests in watch mode
```

## 📖 Documentation

Concise developer entry — implementation-level documentation lives in the `docs/` folder. Click any link below to open the topic.

### Architecture & Auth

- [Auth flow (concise)](docs/AUTH_FLOW.md) — Step-by-step: Firebase Auth → `exchangeToken` cloud function → Supabase session tokens.
- [Auth source-of-truth](docs/AUTH_SOURCE_OF_TRUTH.md) — Why Firebase is the canonical identity provider and how Supabase is used downstream.
- [Navigation structure](docs/NAVIGATION.md) — Overview of app navigation, including Drawer, Tab, and Stack navigators.

### Data & Features

- [Characters data model](docs/CHARACTERS.md) — Tables, RLS, types, and common queries for Yours Brightly characters.
- [Image generation](docs/IMAGE_GENERATION.md) — How image generation is integrated with OpenAI and Supabase storage.
- [Supabase subscription & RLS](docs/SUPABASE_AUTH.md) — Full multi-tenant subscription architecture, JWT claims, and RLS examples.
- [Supabase data structure](docs/SUPABASE_DATA_STRUCTURE.md) — SQL schemas and TypeScript interfaces for core tables (users, characters, messages, subscriptions).

### Payments & Subscriptions

- [Payment API reference](docs/PAYMENT_API.md) — Transaction manager, webhook endpoints, and auth requirements.
- [Payment integration](docs/PAYMENT_INTEGRATION.md) — Client-side integration patterns for payments and subscriptions.
- [Payment system design](docs/PAYMENT_SYSTEM.md) — Architecture and billing flow for multi-tenant subscriptions.
- [Payment troubleshooting](docs/PAYMENT_TROUBLESHOOTING.md) — Common webhook and billing errors with fixes.

### Policies & Compliance

- [Privacy integration](docs/PRIVACY_INTEGRATION.md) — How privacy policy and user consent are handled.
- [Terms integration](docs/TERMS_INTEGRATION.md) — Legacy terms flow vs subscription-driven access control.

### Platform Configuration

- **[Firebase Platform Config](docs/FIREBASE_PLATFORM_CONFIG.md)** — Normalized Firebase API for web and native with platform-specific implementations.
- **[Firebase Platform Fixes](docs/FIREBASE_PLATFORM_FIXES.md)** — Solutions for React Native Firebase v22 migration, Vertex AI setup, and deprecation warnings.

## 🏗️ Tech Stack

- **Frontend**: React Native 0.81, Expo SDK 54, TypeScript 5.9
- **Navigation**: Expo Router (file-based routing)
- **Authentication**: Firebase Auth
- **Backend**: Supabase (PostgreSQL + Storage + Real-time)
- **AI**: Google Cloud Vertex AI
- **State Management**: React Query (TanStack Query)
- **Payments**: RevenueCat + Stripe
- **UI Components**: React Native Paper, Gifted Chat

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- How to set up your development environment
- Our code style and conventions
- How to submit pull requests
- Our commit message format

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## 🔒 Security

If you discover a security vulnerability, please email [info@equationalapplications.com](mailto:info@equationalapplications.com). Do not create a public issue. See [SECURITY.md](SECURITY.md) for more details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Expo](https://expo.dev/)
- UI components from [React Native Paper](https://reactnativepaper.com/)
- Chat interface powered by [React Native Gifted Chat](https://github.com/FaridSafi/react-native-gifted-chat)
- AI capabilities provided by [Google Cloud Vertex AI](https://cloud.google.com/vertex-ai)

## 📞 Support

- **Documentation**: Check the `/docs` folder for detailed guides
- **Issues**: [GitHub Issues](https://github.com/equationalapplications/yoursbrightlyai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/equationalapplications/yoursbrightlyai/discussions)
- **Email**: [info@equationalapplications.com](mailto:info@equationalapplications.com)

---

Made with ❤️ by [Equational Applications LLC](https://equationalapplications.com)
