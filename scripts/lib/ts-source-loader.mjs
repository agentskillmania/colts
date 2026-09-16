/**
 * @fileoverview 最小 Node ESM loader：让本仓 TypeScript 源码可直接 import。
 *
 * 仅服务于 scripts/export-contracts.mjs（契约快照导出），不参与构建/门禁：
 * - resolve：把相对说明符里的 `./x.js` 改指同目录的 `x.ts`（TS 源码的
 *   ESM 风格扩展名约定）；找不到同名 .ts 时原样交给默认解析（因此
 *   node_modules 里的真 .js 与裸说明符不受影响）。
 * - load：`.ts` 用 typescript.transpileModule 就地转译成 ESM。
 *   纯语法级转译（不做类型检查、不做类型驱动解析）——够用是因为 colts
 *   源码的跨模块引用全部显式带扩展名，且 import type 会被擦除。
 *
 * 为什么不直接 import dist：fixtures 必须锚在**当前源码**上，dist 可能过期
 * （Bash 里先跑 pnpm build 只掩盖了这一点）；loader 让导出脚本读什么就评审什么。
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

/** 相对说明符 `…/x.js` → 若同目录存在 `x.ts` 则改指它。 */
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js')) {
    const parent = context.parentURL;
    if (parent && parent.startsWith('file:')) {
      const tsPath = fileURLToPath(new URL(specifier, parent)).replace(/\.js$/, '.ts');
      if (existsSync(tsPath)) {
        return { url: pathToFileURL(tsPath).href, shortCircuit: true, format: 'module' };
      }
    }
  }
  return nextResolve(specifier, context);
}

/** `.ts` → 转译后的 ESM。 */
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        // 关闭类型驱动删除的依赖：erasableSyntaxOnly 语义下只剩语法级擦除
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
        isolatedModules: true,
        verbatimModuleSyntax: false,
      },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
