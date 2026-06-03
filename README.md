# Clanker

> An AI chatbot Expo app with Firebase + Cloud SQL architecture. Users create custom characters and chat with them using Vertex AI, with subscription-based access control.

## Documentation Deep Dives

### Authentication
- **[Authentication](docs/authentication.md)** — Source of truth, Firebase → Cloud SQL bootstrap flow, auth cache management, provider name sync, event-driven refresh, cookie consent, and optimistic terms acceptance — all in one place.

### AI & Chat
- **[AI & Chat](docs/ai-and-chat.md)** — Chat response pipeline (`generateReply`), chat memory summarization, LLM Wiki Memory (structured facts/tasks/events), wiki state machine architecture, and image generation (`generateImage`).

### Billing & Credits
- **[Billing & Credits](docs/billing-and-credits.md)** — First-login credits, Stripe and RevenueCat webhook event mappings, web checkout flow, Apple auto-renewable subscription consent, and multi-tab checkout robustness (localStorage + BroadcastChannel).

### Admin Operations
- **[Admin Operations](docs/admin-operations.md)** — Web-only admin dashboard UX, callable function contracts (list/set/reset/delete), authorization model, audit logging, and runbook with action procedures.

### Architecture & Data
- **[Architecture & Data](docs/architecture-and-data.md)** — State management (xState / TanStack Query / SQLite), navigation (Expo Router), offline support architecture, Cloud SQL schema design & migrations, cloud character save/share, avatar upload, and support page.

### ADRs
- **[ADR 001: Callable Error Normalization](docs/adrs/001-callable-error-normalization.md)** — How callable handlers map bootstrap/config errors to stable `HttpsError` codes.

### Workflows & Debugging
- **[Contributing Guide](CONTRIBUTING.md)** — Git workflow, merge strategy, coding standards, commit guidelines (Conventional Commits), testing (root + functions), web debugging, and PR process — all in one place.

### Other Reference
- **[Accessibility Guide](docs/accessibility.md)** — Conventions for `accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, live regions, and skip links.

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
- Agentic memory powered by [expo-llm-wiki](https://github.com/equationalapplications/expo-llm-wiki)

## 📞 Support

- **Documentation**: Check the `/docs` folder for detailed guides
- **Issues**: [GitHub Issues](https://github.com/equationalapplications/clanker/issues)
- **Discussions**: [GitHub Discussions](https://github.com/equationalapplications/clanker/discussions)
- **Email**: [info@equationalapplications.com](mailto:info@equationalapplications.com)

---

Made with ❤️ by [Equational Applications LLC](https://equationalapplications.com)
