import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "*.js",
            "*.ts",
            "demos/*.ts",
            "tests/*.ts",
            "tests/case-file-persistence/*.ts",
            "tests/gate-interface/*.ts",
            "tests/single-surface-state-machine/*.ts",
          ],
          // ponytail: raw count ceiling, keeps needing a bump as slices add
          // demos/tests files; a real fix gives demos/tests their own
          // tsconfig project instead of piggybacking on the default one.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 40,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ["dist/", "node_modules/"],
  }
);
