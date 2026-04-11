/**
 * @fileoverview colts CLI 主题配置 — 基于 @inkjs/ui 的主题扩展
 */

import { extendTheme, defaultTheme } from '@inkjs/ui';

/**
 * colts 自定义主题
 *
 * 在 @inkjs/ui 默认主题基础上，统一组件风格。
 * 所有颜色使用 ANSI 前景色，跟随终端主题。
 */
export const coltsTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: () => ({
          color: 'yellow',
        }),
        label: () => ({
          color: 'gray',
        }),
      },
    },

    Badge: {
      styles: {
        container: ({ color }) => ({
          color,
          paddingBottom: 0,
          paddingTop: 0,
        }),
      },
    },

    Select: {
      styles: {
        indicator: ({ isFocused }) => ({
          color: isFocused ? 'cyan' : 'gray',
        }),
        label: ({ isFocused }) => ({
          color: isFocused ? 'white' : 'gray',
          bold: isFocused,
        }),
      },
    },

    MultiSelect: {
      styles: {
        groupCheckmark: ({ isChecked }) => ({
          color: isChecked ? 'green' : 'gray',
        }),
        label: ({ isFocused }) => ({
          color: isFocused ? 'white' : 'gray',
        }),
      },
    },

    TextInput: {
      styles: {
        placeholder: () => ({
          color: 'gray',
        }),
      },
    },

    ConfirmInput: {
      styles: {
        confirm: ({ isConfirmed }) => ({
          color: isConfirmed ? 'green' : 'red',
        }),
      },
    },
  },
});
