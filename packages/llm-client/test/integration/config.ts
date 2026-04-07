/**
 * Integration test configuration
 *
 * IMPORTANT: Copy this file to config.local.ts and fill in your actual API keys.
 * config.local.ts is gitignored and should never be committed.
 */

export interface TestConfig {
  /** OpenAI API Key (required for most tests) */
  openaiApiKey: string;
  /** Optional: Second OpenAI API Key for multi-key tests */
  openaiApiKey2?: string;
  /** OpenAI Base URL (optional, for proxy users) */
  openaiBaseUrl?: string;
  /** Test model to use (default: gpt-3.5-turbo for cost saving) */
  testModel: string;
  /** Enable integration tests (set to true to run) */
  enabled: boolean;
}

// Default config - tests will be skipped unless enabled
export const testConfig: TestConfig = {
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiApiKey2: process.env.OPENAI_API_KEY2 || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  testModel: process.env.TEST_MODEL || 'gpt-3.5-turbo',
  enabled: process.env.ENABLE_INTEGRATION_TESTS === 'true',
};

// Helper to skip tests when not configured
export const itif = (condition: boolean) => (condition ? it : it.skip);
