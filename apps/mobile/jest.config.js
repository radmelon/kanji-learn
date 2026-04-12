module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
        },
      },
    ],
  },
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  moduleNameMapper: {
    '^expo-web-browser$': '<rootDir>/test/__mocks__/expo-web-browser.ts',
    '^expo-auth-session$': '<rootDir>/test/__mocks__/expo-auth-session.ts',
    '^(\\.+/)*supabase$': '<rootDir>/test/__mocks__/supabase.ts',
    '^expo-secure-store$': '<rootDir>/test/__mocks__/expo-secure-store.ts',
  },
}
