# Clanker

> An AI chatbot Expo app with Firebase + Cloud SQL architecture. Users create custom characters and chat with them using Vertex AI, with subscription-based access control.

## Getting Started

- **[Git Workflow & Branching](docs/GIT_WORKFLOW.md)** — Branch strategy (staging → main), PR process, commit guidelines, and conventional commits.
- **[Merge Strategy](docs/MERGE_STRATEGY.md)** — How to promote code from staging → main (and sync main → staging) using merge commits.
- **[Expo Updates & Runtime Versioning](docs/EXPO_UPDATES.md)** — How OTA updates work, runtime version strategy, and the relationship between conventional commits and deployment types (OTA vs native builds).

## State Management

- [State management architecture](docs/STATE_MANAGEMENT.md) — Layer overview (xState / TanStack Query / SQLite), when and how to add new xState machines, inter-machine coordination via `AppOrchestrator`, and how `useCurrentPlan` derives plan tier from the auth machine.

## Architecture & Auth

- [Auth flow (concise)](docs/AUTH_FLOW.md) — Step-by-step: Firebase Auth → `exchangeToken` cloud function → Cloud SQL bootstrap payload.
- [Auth source-of-truth](docs/AUTH_SOURCE_OF_TRUTH.md) — Why Firebase is the canonical identity provider and how Cloud SQL bootstrap state is used downstream.
- [Auth provider name sync](docs/AUTH_PROVIDER_NAME_SYNC.md) — How Apple/Google names are captured and synced to profile display data.
- [Bootstrap event-driven refresh](docs/BOOTSTRAP_EVENT_DRIVEN_REFRESH.md) — How auth bootstrap reconciliation now works without interval polling, including refresh reason semantics, lifecycle triggers, and usage snapshot updates.
- [Firebase setup](docs/FIREBASE_SETUP.md) — How to configure mobile Firebase app files for EAS builds and local builds.
- [Firebase Cloud Functions](docs/FIREBASE_FUNCTIONS.md) — How backend functions (`exchangeToken`, `purchasePackageStripe`) are managed and deployed.
- [Callable error normalization](docs/CALLABLE_ERROR_NORMALIZATION.md) — How callable handlers map bootstrap/config errors to stable `HttpsError` codes without leaking internals.
- [Chat response function](docs/CHAT_RESPONSE_FUNCTION.md) — Secure callable architecture for server-side text generation, auth checks, and credit billing.
- [Image generation function](docs/IMAGE_GENERATION_FUNCTION.md) — Server-side image generation with auth, billing, and abuse controls.
- [Firebase Functions testing](docs/FIREBASE_FUNCTIONS_TESTING.md) — Test strategy and local commands for callable and webhook function coverage in `functions/`.
- [Navigation structure](docs/NAVIGATION.md) — Overview of app navigation, including Drawer, Tab, and Stack navigators.
- [Admin dashboard](docs/ADMIN_DASHBOARD.md) — Web-only admin UX architecture, route guards, and mandatory confirmation behavior for privileged actions.
- [Admin functions](docs/ADMIN_FUNCTIONS.md) — Callable contracts, authorization model, validation rules, and audit logging schema.
- [Admin runbook](docs/ADMIN_RUNBOOK.md) — Operational procedures and safety checklists for reset/delete workflows.

## Data & Features

- [Image generation](docs/IMAGE_GENERATION.md) — Callable-based image generation flow with local SQLite avatar storage.
- [Chat memory summarization](docs/CHAT_MEMORY_SUMMARIZATION.md) — Background conversation summarization every 20 messages with SQLite pruning and context compaction.
- [First-login credits](docs/FIRST_LOGIN_CREDITS.md) — How first-login users are provisioned to 50 free credits.
- [Cloud character save + share](docs/CLOUD_CHARACTER_SAVE_SHARE.md) — Subscription-gated cloud save toggles, shareable character links, and deep-link import flow.
- [Cloud SQL design](docs/CLOUD_SQL_DESIGN.md) — Current PostgreSQL schema and service-layer architecture for users, subscriptions, characters, and messages.

## Payments & Subscriptions

- [Payment API reference](docs/PAYMENT_API.md) — Transaction manager, webhook endpoints, and auth requirements.
- [Payment integration](docs/PAYMENT_INTEGRATION.md) — Client-side integration patterns for payments and subscriptions.
- [Payment system design](docs/PAYMENT_SYSTEM.md) — Architecture and billing flow for multi-tenant subscriptions.
- [Payment troubleshooting](docs/PAYMENT_TROUBLESHOOTING.md) — Common webhook and billing errors with fixes.
- [Multi-tab checkout robustness](docs/CHECKOUT_MULTI_TAB_SYNC.md) — How Stripe return-tab recovery works using localStorage, BroadcastChannel, per-product locks, and event-driven refresh without polling.

## Policies & Compliance

- [Privacy integration](docs/PRIVACY_INTEGRATION.md) — How privacy policy and user consent are handled.
- [Cookie consent (web)](docs/COOKIE_CONSENT.md) — Lower-right banner with Accept/Reject parity, granular preferences, and `canUse()` gating for non-essential cookies, satisfying GDPR + Quebec Law 25.
- [Terms integration](docs/TERMS_INTEGRATION.md) — Legacy terms flow vs subscription-driven access control.
- [Apple subscription consent](docs/APPLE_SUBSCRIPTION_CONSENT.md) — Paywall legal-link requirements, Terms + Apple EULA hosting, and safe custom-consent scope for auto-renewable subscriptions.
- [Support page](docs/SUPPORT_PAGE.md) — Public support route and FAQ content used for App Store support URL compliance.

## 🏗️ Tech Stack

- **Frontend**: React Native 0.81, Expo SDK 54, TypeScript 5.9
- **Navigation**: Expo Router (file-based routing)
- **Authentication**: Firebase Auth
- **Backend**: Firebase Functions + Cloud SQL (PostgreSQL)
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
