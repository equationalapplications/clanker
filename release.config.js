// Staging: tag + GitHub release only (no file commits → no merge conflicts).
// Main: full release with CHANGELOG, version bump, and git commit.
const isMain = process.env.GITHUB_REF === 'refs/heads/main' || process.env.BRANCH === 'main'

const plugins = [
  '@semantic-release/commit-analyzer',
  '@semantic-release/release-notes-generator',
]

if (isMain) {
  plugins.push(
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    ['@semantic-release/npm', { npmPublish: false }],
    ['@semantic-release/github', { successComment: false, failComment: false }],
    [
      '@semantic-release/git',
      {
        assets: ['CHANGELOG.md', 'package.json', 'package-lock.json'],
        message:
          'chore(release): set `package.json` to ${nextRelease.version} [skip ci]',
      },
    ],
  )
} else {
  // Staging – lightweight: GitHub release + tag, no file mutations
  plugins.push(
    ['@semantic-release/npm', { npmPublish: false }],
    ['@semantic-release/github', { successComment: false, failComment: false }],
  )
}

module.exports = {
  branches: [
    'main',
    {
      name: 'staging',
      prerelease: true,
    },
  ],
  plugins,
}
