/**
 * @fileoverview Execution Engine module entry point
 *
 * Re-exports phase handler interfaces, router, and default handlers.
 */

export type { IPhaseHandler, PhaseHandlerContext } from './types.js';
export { PhaseRouter } from './router.js';
