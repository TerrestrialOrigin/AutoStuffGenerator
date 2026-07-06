import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Never lint build output or dependencies.
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },

  pluginJs.configs.recommended,

  // Type-aware rules for all TypeScript sources (src + scripts + specs).
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        // Dedicated lint project so *.spec.ts and scripts/ (excluded from the
        // build tsconfig) still get full type information.
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // The flat-config file itself is plain JS — turn off type-aware rules for it
  // so it need not belong to a TypeScript project.
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },
);
