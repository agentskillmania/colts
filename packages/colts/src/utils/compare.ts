/**
 * @fileoverview Deterministic string comparison shared by cache-critical
 * enumerations (tool schemas/names, skill catalogs).
 */

/**
 * Compare two strings by UTF-16 code unit (the `<` / `>` operator order) —
 * deliberately NOT `localeCompare`.
 *
 * Ordering is a structural property, not cosmetics: both consumers feed the
 * provider prefix cache. The wire `tools` array is the very front of the
 * request token stream (tools → system → messages), and the skill catalog is
 * the first line of the system document. `localeCompare` collation depends
 * on the host locale/runtime, so two machines (or two Node builds) could
 * enumerate the same set differently and invalidate the cache wholesale.
 * Sorting by code unit is host-independent, cross-instance deterministic and
 * matches Rust's ordering for the ASCII slugs used as tool/skill names.
 * (R2P-101a/101b, aligned with Rust 5120a3e / 5e238bc.)
 *
 * Caveat vs Rust's byte-wise `String` ordering: UTF-16 code-unit order and
 * UTF-8 byte order agree on the BMP, but diverge for supplementary-plane
 * characters (a surrogate half sits in 0xD800–0xDFFF, below most BMP
 * letters, whereas its UTF-8 encoding starts at 0xF0). Tool/skill names are
 * ASCII slugs, so the two orderings coincide in practice; only exotic
 * non-BMP names could differ.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Negative when `a` sorts first, positive when `b` does, 0 when equal
 */
export function compareByCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
