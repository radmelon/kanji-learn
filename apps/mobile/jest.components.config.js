module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/components/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-components.ts'],
  moduleNameMapper: {
    '^@kanji-learn/shared$': '<rootDir>/../../packages/shared/src/index.ts',
  },
}
