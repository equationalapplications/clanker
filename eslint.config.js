import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
    js.configs.recommended,
    {
        files: ["**/*.{js,ts,tsx}"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                ecmaFeatures: {
                    jsx: true,
                },
            },
            globals: {
                console: "readonly",
                process: "readonly",
                Buffer: "readonly",
                __dirname: "readonly",
                module: "readonly",
                require: "readonly",
                exports: "readonly",
            },
        },
        plugins: {
            "@typescript-eslint": tseslint,
            "react-hooks": reactHooks,
        },
        rules: {
            // React Hooks rules to catch infinite loops and dependency issues
            "react-hooks/rules-of-hooks": "error",
            "react-hooks/exhaustive-deps": "warn", // This would catch the infinite loop issue

            // TypeScript rules
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "warn",

            // General rules
            "no-console": "off", // Allow console logs in React Native
            "prefer-const": "warn",
        },
    },
    {
        ignores: ["web-build/**", "dist/**", "node_modules/**", ".expo/**"],
    },
];