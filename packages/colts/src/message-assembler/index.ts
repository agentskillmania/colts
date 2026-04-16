/**
 * @fileoverview Message Assembler module entry point
 *
 * Re-exports the message assembler interface and default implementation.
 */

export type { IMessageAssembler, BuildMessagesOptions } from './types.js';
export { DefaultMessageAssembler } from './default-assembler.js';
