/**
 * @fileoverview colts CLI theme configuration — theme extension based on @inkjs/ui
 */

import { extendTheme, defaultTheme } from '@inkjs/ui';

/**
 * colts custom theme
 *
 * Extends the @inkjs/ui default theme for consistent component styling.
 * All colors use ANSI foreground colors, following the terminal theme.
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
