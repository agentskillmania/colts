/**
 * @fileoverview Utility functions for generating identifiers
 */

/**
 * Generate unique ID
 *
 * @returns Unique identifier string
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
