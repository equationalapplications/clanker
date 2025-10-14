# Contributing to Yours Brightly AI

Thank you for your interest in contributing to Yours Brightly AI! This document provides guidelines and instructions for contributing to this project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a Code of Conduct that all contributors are expected to follow. Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before contributing.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/yoursbrightlyai.git
   cd yoursbrightlyai
   ```
3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/equationalapplications/yoursbrightlyai.git
   ```

## Development Setup

### Prerequisites

- Node.js (v18 or later)
- npm (v9 or later)
- Expo CLI
- iOS Simulator (for iOS development) or Android Studio (for Android development)

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Fill in the required values in `.env` (see README.md for details)

3. **Start the development server**:
   ```bash
   npm start
   ```

### Important Files to Review

Before contributing, please read:
- [README.md](README.md) - Project overview and documentation index
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - Development patterns and architecture
- Documentation in `/docs` folder - Detailed implementation guides

## How to Contribute

### Reporting Bugs

- Check if the bug has already been reported in [Issues](https://github.com/equationalapplications/yoursbrightlyai/issues)
- If not, create a new issue with:
  - Clear title and description
  - Steps to reproduce
  - Expected vs actual behavior
  - Screenshots (if applicable)
  - Environment details (OS, device, app version)

### Suggesting Features

- Check existing [Issues](https://github.com/equationalapplications/yoursbrightlyai/issues) for similar suggestions
- Create a new issue with:
  - Clear description of the feature
  - Use cases and benefits
  - Potential implementation approach (optional)

### Contributing Code

1. **Choose or create an issue** to work on
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our coding standards
4. **Test thoroughly** (see Testing section)
5. **Commit your changes** (see Commit Message Guidelines)
6. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
7. **Create a Pull Request** on GitHub

## Pull Request Process

1. **Update documentation** if your changes affect usage or APIs
2. **Add tests** for new functionality
3. **Run all checks**:
   ```bash
   npm run lint
   npm run typecheck
   npm test
   ```
4. **Ensure your PR**:
   - Has a clear title and description
   - References related issues (e.g., "Fixes #123")
   - Includes screenshots for UI changes
   - Has no merge conflicts with main branch
5. **Request review** from maintainers
6. **Address feedback** promptly
7. **Squash commits** if requested before merge

### PR Title Format

Use conventional commit format:
- `feat: add new feature`
- `fix: resolve bug in component`
- `docs: update README`
- `chore: update dependencies`

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Define proper types (avoid `any`)
- Use interfaces for object shapes
- Export types when they're used across files

### React Native / React

- Use functional components with hooks
- Keep components focused and reusable
- Use `memo` for performance when appropriate
- Follow the existing component structure in the project

### File Organization

- Follow the existing directory structure
- Place components in `/src/components` or `/app` (for screens)
- Place hooks in `/src/hooks`
- Place services in `/src/services`
- Add documentation to `/docs` for major features

### Naming Conventions

- **Components**: PascalCase (e.g., `CharacterList.tsx`)
- **Hooks**: camelCase starting with `use` (e.g., `useCharacter.ts`)
- **Utils/Services**: camelCase (e.g., `characterService.ts`)
- **Constants**: SCREAMING_SNAKE_CASE (e.g., `MAX_CHARACTERS`)

### Code Style

- Use Prettier for formatting (runs automatically on commit)
- Use ESLint rules (run `npm run lint`)
- Add comments for complex logic
- Keep functions small and focused
- Avoid deeply nested code

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, missing semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks, dependency updates

### Examples

```
feat(characters): add character sharing functionality

Implement ability to share characters with other users via unique link.
Includes privacy controls and permission management.

Closes #123
```

```
fix(auth): resolve Firebase token refresh issue

Fix race condition where token refresh could fail during
background sync, causing authentication errors.

Fixes #456
```

## Testing

### Running Tests

```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
```

### Writing Tests

- Add tests for new features in `__tests__` directory
- Follow existing test patterns
- Test both success and error cases
- Mock external dependencies (Firebase, Supabase, etc.)

### Manual Testing

Before submitting a PR:
1. Test on iOS simulator/device
2. Test on Android emulator/device
3. Test on web (if applicable)
4. Test with different subscription states
5. Test offline behavior

## Documentation

### Code Documentation

- Add JSDoc comments for public APIs
- Document complex algorithms or business logic
- Keep comments up-to-date with code changes

### Project Documentation

- Update relevant docs in `/docs` folder
- Add links in README.md for new major features
- Include code examples in documentation
- Keep the documentation style consistent

### API Documentation

When adding new APIs or changing existing ones:
1. Document parameters and return types
2. Provide usage examples
3. Note any breaking changes
4. Update related documentation files

## Getting Help

- **Questions**: Open a [Discussion](https://github.com/equationalapplications/yoursbrightlyai/discussions)
- **Bugs**: Open an [Issue](https://github.com/equationalapplications/yoursbrightlyai/issues)
- **Security**: Email [info@equationalapplications.com](mailto:info@equationalapplications.com)

## Recognition

Contributors will be recognized in:
- GitHub contributors page
- Release notes (for significant contributions)

Thank you for contributing to Yours Brightly AI! 🎉
