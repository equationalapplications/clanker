# Security Policy

## Supported Versions

We release patches for security vulnerabilities in the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 10.x    | :white_check_mark: |
| < 10.0  | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in Clanker, please report it by emailing [info@equationalapplications.com](mailto:info@equationalapplications.com).

**Please do not report security vulnerabilities through public GitHub issues.**

### What to Include

When reporting a vulnerability, please include:

- A description of the vulnerability
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes (if applicable)

### Response Timeline

- We will acknowledge receipt of your vulnerability report within 48 hours
- We will provide a detailed response within 7 days, including next steps
- We will notify you when the vulnerability has been fixed

## Security Best Practices

### For Contributors

1. **Never commit sensitive data**: API keys, passwords, tokens, or credentials should never be committed to the repository
2. **Use environment variables**: All secrets should be stored in environment variables (see `.env.example`)
3. **Keep dependencies updated**: Regularly update dependencies to patch known vulnerabilities
4. **Review code carefully**: Look for potential security issues in pull requests

### For Users

1. **Protect your Firebase config files**: Never share `google-services.json` or `GoogleService-Info.plist`
2. **Use strong authentication**: Enable strong authentication methods in Firebase
3. **Keep the app updated**: Always use the latest version of the app
4. **Secure your environment variables**: Use proper secret management for production deployments

## Security Measures

This project implements several security measures:

- **Firebase Authentication**: Secure user authentication with Firebase Auth
- **Row Level Security (RLS)**: Supabase RLS policies protect user data
- **JWT-based Authorization**: Subscription-based access control via JWT claims
- **Environment-based Configuration**: All secrets managed via environment variables
- **HTTPS Only**: All API communications use HTTPS

## Third-Party Services

This application integrates with:

- **Firebase** (Authentication, Crashlytics)
- **Supabase** (Database, Storage)
- **Google Cloud Vertex AI** (AI chat functionality)
- **Stripe** (Payment processing and subscription management)

Please ensure you follow security best practices for each service.

## Responsible Disclosure

We appreciate the security research community's efforts to improve the security of our project. We are committed to working with security researchers to verify and address potential vulnerabilities.
