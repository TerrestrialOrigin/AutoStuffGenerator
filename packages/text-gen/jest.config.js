export default {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/*.spec.ts'],
    // Resolve the contracts package to its TypeScript source so ts-jest compiles it
    // directly — always current (no pre-built dist needed for tests) and free of
    // ESM/CJS interop friction from importing the built ESM bundle.
    moduleNameMapper: {
        '^auto-stuff-generator$': '<rootDir>/../auto-stuff-generator/src/index.ts',
    },
};
