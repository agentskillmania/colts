/**
 * Integration test configuration for colts
 *
 * @remarks
 * This module loads configuration from environment variables.
 * Environment variables are loaded from the root `.env` file via dotenv
 * in vitest.config.ts.
 *
 * Required environment variables:
 * - OPENAI_API_KEY: Your API key for the LLM provider
 *
 * Optional environment variables:
 * - OPENAI_BASE_URL: Custom base URL for the API
 * - PROVIDER: Provider name (default: 'openai')
 * - MODEL: Model to use for tests (default: 'gpt-3.5-turbo')
 * - ENABLE_INTEGRATION_TESTS: Set to 'true' to enable integration tests
 */

export interface TestConfig {
  /** API Key for the LLM provider (required) */
  apiKey: string;

  /** Base URL for the API (optional, for custom/proxy endpoints) */
  baseUrl?: string;

  /** Provider name (default: 'openai') */
  provider: string;

  /** Model to use for tests */
  testModel: string;

  /** Whether integration tests are enabled */
  enabled: boolean;

  /** Whether the provider is a custom/OpenAI-compatible endpoint */
  isCustomProvider: boolean;
}

function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';

  if (enabled && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[colts Integration Tests] Warning: ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set.'
    );
  }

  const baseUrl = process.env.OPENAI_BASE_URL;
  const isCustomProvider = !!baseUrl && !baseUrl.includes('api.openai.com');

  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl,
    provider: process.env.PROVIDER || 'openai',
    testModel: process.env.MODEL || 'gpt-3.5-turbo',
    enabled,
    isCustomProvider,
  };
}

export const testConfig: TestConfig = loadConfig();

/**
 * Helper to conditionally run tests based on a condition
 */
export const itif = (condition: boolean) => (condition ? it : it.skip);

/**
 * Log provider information for debugging
 */
export function logProviderInfo(): void {
  if (testConfig.enabled) {
    console.log('[colts Integration Tests] Configuration:');
    console.log(`  Provider: ${testConfig.provider}`);
    console.log(`  Model: ${testConfig.testModel}`);
    console.log(`  Base URL: ${testConfig.baseUrl || 'https://api.openai.com/v1 (default)'}`);
    console.log(`  Custom Provider: ${testConfig.isCustomProvider}`);
  }
}
