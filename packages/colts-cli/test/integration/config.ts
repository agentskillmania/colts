/**
 * @fileoverview Integration test configuration — loads LLM connection parameters from environment variables
 *
 * Environment variables are loaded from root .env file via vitest.config.ts dotenv.
 *
 * Required: OPENAI_API_KEY
 * Optional: OPENAI_BASE_URL, PROVIDER, MODEL, ENABLE_INTEGRATION_TESTS
 */

/** Integration test configuration */
export interface TestConfig {
  /** API Key */
  apiKey: string;
  /** Base URL (custom endpoint) */
  baseUrl?: string;
  /** Provider name */
  provider: string;
  /** Test model */
  testModel: string;
  /** Whether integration tests are enabled */
  enabled: boolean;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';

  if (enabled && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[colts-cli Integration Tests] ENABLE_INTEGRATION_TESTS=true but OPENAI_API_KEY is not set'
    );
  }

  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.OPENAI_BASE_URL,
    provider: process.env.PROVIDER || 'openai',
    testModel: process.env.MODEL || 'gpt-3.5-turbo',
    enabled,
  };
}

export const testConfig: TestConfig = loadConfig();

/** Conditional test: execute when condition is true, skip otherwise */
export const itif = (condition: boolean) => (condition ? it : it.skip);

/** Print provider info for debugging */
export function logProviderInfo(): void {
  if (testConfig.enabled) {
    console.log('[colts-cli Integration Tests] Configuration:');
    console.log(`  Provider: ${testConfig.provider}`);
    console.log(`  Model: ${testConfig.testModel}`);
    console.log(`  Base URL: ${testConfig.baseUrl || 'default'}`);
  }
}
