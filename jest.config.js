module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    '**/tests/**/*.test.ts',
    '**/tests/**/*.test.tsx',
  ],
  moduleNameMapper: {
    // Map @env to a mock so tests don't need a real .env
    '^@env$': '<rootDir>/tests/__mocks__/env.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-navigation|zustand)/)',
  ],
};
