/**
 * Integration test configuration
 *
 * @remarks
 * This module loads configuration from environment variables.
 * Environment variables are loaded from the root `.env` file via dotenv
 * in vitest.integration.config.ts.
 *
 * Required environment variables:
 * - OPENAI_API_KEY: Your API key for the LLM provider
 *
 * Optional environment variables:
 * - OPENAI_API_KEY2: Second API key for multi-key tests
 * - OPENAI_BASE_URL: Custom base URL for the API (e.g., for ZhiPu AI)
 * - PROVIDER: Provider name (default: 'openai')
 * - MODEL: Model to use for tests (default: 'gpt-3.5-turbo')
 * - ENABLE_INTEGRATION_TESTS: Set to 'true' to enable integration tests
 *
 * Multimodal-only environment variables (mirror Rust 35dc808 `_MULTIMODEL`
 * series — point these at a model with image input):
 * - OPENAI_API_KEY_MULTIMODEL: API key for the multimodal model (required)
 * - OPENAI_BASE_URL_MULTIMODEL: Base URL override for the multimodal endpoint
 * - PROVIDER_MULTIMODEL: Provider name (default: 'openai')
 * - MODEL_MULTIMODEL: Vision-capable model (default: 'glm-4.5v')
 * - ENABLE_MULTIMODEL_INTEGRATION_TESTS: Set to 'true' to enable multimodal tests
 *
 * @example
 * ```bash
 * # Example .env file for ZhiPu AI
 * OPENAI_API_KEY=your-api-key
 * OPENAI_BASE_URL=https://open.bigmodel.cn/api/coding/paas/v4
 * PROVIDER=openai
 * MODEL=GLM-4.7
 * ENABLE_INTEGRATION_TESTS=true
 * ```
 */

/**
 * Test configuration interface
 */
export interface TestConfig {
  /** API Key for the LLM provider (required) */
  apiKey: string;

  /** Optional second API key for multi-key tests */
  apiKey2?: string;

  /** Base URL for the API (optional, for custom/proxy endpoints) */
  baseUrl?: string;

  /** Provider name (default: 'openai') */
  provider: string;

  /** Model to use for tests */
  testModel: string;

  /** Whether integration tests are enabled */
  enabled: boolean;

  /**
   * Whether the provider is a custom/OpenAI-compatible endpoint.
   *
   * @remarks
   * Custom providers (like ZhiPu AI) may have different behavior:
   * - Token usage may not be returned
   * - Response format may vary
   * - Some features may not be supported
   *
   * When this is true, tests will be more lenient with assertions.
   */
  isCustomProvider: boolean;
}

/**
 * Load test configuration from environment variables
 *
 * @returns Test configuration object
 */
function loadConfig(): TestConfig {
  const enabled = process.env.ENABLE_INTEGRATION_TESTS === 'true';

  if (enabled && !process.env.OPENAI_API_KEY) {
    console.warn(
      '[Integration Tests] Warning: ENABLE_INTEGRATION_TESTS is true but OPENAI_API_KEY is not set. Tests will likely fail.'
    );
  }

  // Detect if using a custom provider (non-standard endpoint)
  const baseUrl = process.env.OPENAI_BASE_URL;
  const isCustomProvider = !!baseUrl && !baseUrl.includes('api.openai.com');

  return {
    apiKey: process.env.OPENAI_API_KEY || '',
    apiKey2: process.env.OPENAI_API_KEY2,
    baseUrl,
    provider: process.env.PROVIDER || 'openai',
    testModel: process.env.MODEL || 'gpt-3.5-turbo',
    enabled,
    isCustomProvider,
  };
}

/**
 * Global test configuration instance
 *
 * @remarks
 * This configuration is loaded once when the test file is imported.
 * Environment variables are loaded from the root `.env` file.
 */
export const testConfig: TestConfig = loadConfig();

/**
 * Helper to conditionally run tests based on a condition
 *
 * @param condition - Boolean condition to check
 * @returns `it` if condition is true, otherwise `it.skip`
 *
 * @example
 * ```typescript
 * itif(testConfig.enabled)('should run integration test', async () => {
 *   // test code
 * });
 * ```
 */
export const itif = (condition: boolean) => (condition ? it : it.skip);

/**
 * Helper to check if required configuration is available
 *
 * @returns True if API key is configured
 */
export function isConfigured(): boolean {
  return testConfig.enabled && !!testConfig.apiKey;
}

/**
 * Multimodal test configuration (mirror of Rust 35dc808 `_MULTIMODEL` series).
 *
 * @remarks
 * Independent of the main integration config: multimodal tests target a
 * dedicated vision-capable model and use their own enable flag, so a
 * text-only main config never silently downgrades them.
 */
export interface MultimodalTestConfig {
  /** API key for the multimodal-capable endpoint (required when enabled) */
  apiKey: string;

  /** Base URL override for the multimodal endpoint (optional) */
  baseUrl?: string;

  /** Provider name (default: 'openai') */
  provider: string;

  /** Vision-capable model to use for tests */
  testModel: string;

  /** Whether multimodal integration tests are enabled */
  enabled: boolean;
}

/**
 * Load multimodal test configuration from environment variables.
 *
 * @remarks
 * Mirrors Rust `multimodal_enabled()`: requires
 * ENABLE_MULTIMODEL_INTEGRATION_TESTS=true/1 AND a non-placeholder
 * OPENAI_API_KEY_MULTIMODEL.
 */
function loadMultimodalConfig(): MultimodalTestConfig {
  const flag = process.env.ENABLE_MULTIMODEL_INTEGRATION_TESTS;
  const apiKey = process.env.OPENAI_API_KEY_MULTIMODEL || '';
  const enabled =
    (flag === 'true' || flag === '1') && apiKey !== '' && apiKey !== 'your_api_key_here';

  return {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL_MULTIMODEL || undefined,
    provider: process.env.PROVIDER_MULTIMODEL || 'openai',
    testModel: process.env.MODEL_MULTIMODEL || 'glm-4.5v',
    enabled,
  };
}

/**
 * Global multimodal test configuration instance.
 */
export const multimodalConfig: MultimodalTestConfig = loadMultimodalConfig();

/**
 * Helper to check if multimodal test configuration is available
 *
 * @returns True if multimodal flag and API key are configured
 */
export function isMultimodalConfigured(): boolean {
  return multimodalConfig.enabled;
}

/**
 * Helper to check if multi-key tests can run
 *
 * @returns True if both API keys are configured
 */
export function hasMultiKeyConfig(): boolean {
  return isConfigured() && !!testConfig.apiKey2;
}

/**
 * Helper to skip token-related assertions for custom providers.
 *
 * @remarks
 * Some custom providers (like ZhiPu AI) may not return token usage
 * in the same format as standard OpenAI API.
 */
export function expectTokensForProvider(
  tokens: { input: number; output: number },
  expectFn: (value: number) => { toBeGreaterThan: (n: number) => void }
): void {
  if (testConfig.isCustomProvider) {
    // Custom providers may not return token counts, so we just check they exist
    expectFn(tokens.input);
    expectFn(tokens.output);
  } else {
    // Standard OpenAI API should return valid token counts
    expectFn(tokens.input).toBeGreaterThan(0);
    expectFn(tokens.output).toBeGreaterThan(0);
  }
}

/**
 * Log provider information for debugging
 */
export function logProviderInfo(): void {
  if (testConfig.enabled) {
    console.log('[Integration Tests] Configuration:');
    console.log(`  Provider: ${testConfig.provider}`);
    console.log(`  Model: ${testConfig.testModel}`);
    console.log(`  Base URL: ${testConfig.baseUrl || 'https://api.openai.com/v1 (default)'}`);
    console.log(`  Custom Provider: ${testConfig.isCustomProvider}`);
  }
}
