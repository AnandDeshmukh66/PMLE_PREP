import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: ["node_modules/**", ".next/**", "data/**", "public/**", "playwright-report/**", "test-results/**", "next-env.d.ts"],
  },
];

export default config;
