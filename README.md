# Clanker

> An AI chatbot Expo app with Firebase + Supabase architecture. Users create custom characters and chat with them using Vertex AI, with subscription-based access control.

## Getting Started

- **[Git Workflow & Branching](docs/GIT_WORKFLOW.md)** — Branch strategy (staging → main), PR process, commit guidelines, and conventional commits.
- **[Merge Strategy](docs/MERGE_STRATEGY.md)** — How to promote code from staging → main using squash merges.
- **[Expo Updates & Runtime Versioning](docs/EXPO_UPDATES.md)** — How OTA updates work, runtime version strategy, and the relationship between conventional commits and deployment types (OTA vs native builds).

## Architecture & Auth

- [Auth flow (concise)](docs/AUTH_FLOW.md) — Step-by-step: Firebase Auth → `exchangeToken` cloud function → Supabase session tokens.
- [Auth source-of-truth](docs/AUTH_SOURCE_OF_TRUTH.md) — Why Firebase is the canonical identity provider and how Supabase is used downstream.
- [Navigation structure](docs/NAVIGATION.md) — Overview of app navigation, including Drawer, Tab, and Stack navigators.

## Data & Features

- [Image generation](docs/IMAGE_GENERATION.md) — How image generation is integrated with OpenAI and Supabase storage.
- [Supabase subscription & RLS](docs/SUPABASE_AUTH.md) — Full multi-tenant subscription architecture, JWT claims, and RLS examples.
- [Supabase data structure](docs/SUPABASE_DATA_STRUCTURE.md) — SQL schemas and TypeScript interfaces for core tables (users, characters, messages, subscriptions).

## Payments & Subscriptions

- [Payment API reference](docs/PAYMENT_API.md) — Transaction manager, webhook endpoints, and auth requirements.
- [Payment integration](docs/PAYMENT_INTEGRATION.md) — Client-side integration patterns for payments and subscriptions.
- [Payment system design](docs/PAYMENT_SYSTEM.md) — Architecture and billing flow for multi-tenant subscriptions.
- [Payment troubleshooting](docs/PAYMENT_TROUBLESHOOTING.md) — Common webhook and billing errors with fixes.

## Policies & Compliance

- [Privacy integration](docs/PRIVACY_INTEGRATION.md) — How privacy policy and user consent are handled.
- [Terms integration](docs/TERMS_INTEGRATION.md) — Legacy terms flow vs subscription-driven access control.

## 🏗️ Tech Stack

- **Frontend**: React Native 0.81, Expo SDK 54, TypeScript 5.9
- **Navigation**: Expo Router (file-based routing)
- **Authentication**: Firebase Auth
- **Backend**: Supabase (PostgreSQL + Storage + Real-time)
- **AI**: Google Cloud Vertex AI
- **State Management**: React Query (TanStack Query)
- **Payments**: Stripe
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
- **Issues**: [GitHub Issues](https://github.com/equationalapplications/clanker/issues)
- **Discussions**: [GitHub Discussions](https://github.com/equationalapplications/clanker/discussions)
- **Email**: [info@equationalapplications.com](mailto:info@equationalapplications.com)

---

Made with ❤️ by [Equational Applications LLC](https://equationalapplications.com)
