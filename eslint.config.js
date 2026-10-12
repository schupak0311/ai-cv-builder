import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    ...reactHooks.configs.flat.recommended,
  },
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
);
