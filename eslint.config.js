import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // createAgentPort and fakeAgentPort own the only two casts the generic
    // AgentPort contract forces; anywhere else the cast hides a wrong reply.
    ignores: ["src/agent-invoke.ts", "src/agent-port-double.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression > TSIndexedAccessType[objectType.typeName.name='AgentPort'][indexType.literal.value='invoke']",
          message:
            'Build agent doubles with fakeAgentPort from src/testing.ts: a cast to AgentPort["invoke"] lets a reply of the wrong shape for its role compile.',
        },
      ],
    },
  },
  {
    // examples/ and the packs' fixture projects hold plain JavaScript projects a person copies
    // out; they are outside tsconfig.json, so typed linting cannot parse them.
    ignores: ["dist/", "node_modules/", "vendor/", "examples/", "packs/", "site/"],
  }
);
