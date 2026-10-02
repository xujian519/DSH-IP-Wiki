/**
 * Build faces for dsh-ip-wiki.
 *
 * The Host half is an ordinary ESM Node library (`lib/index.js`) that the
 * profile's Loader imports; it reads the card library and answers the panel's
 * HTTP requests.
 *
 * The Client half must match the DSH dynamic-client contract: a CommonJS file at
 * `lib/client.js` whose only side effect is
 * `window.__ModuleLoader__.load({ id, factory })`. The factory receives the
 * shell's module-table `require`, so React stays the shell's shared instance and
 * nothing else may be imported from DSH packages (types only). The plugin ships
 * no lazy chunk, so no other file may be referenced from the entry.
 */
import { defineConfig } from 'tsdown'

/** Package name the client module loader registers the factory under. */
const PACKAGE_NAME = 'dsh-ip-wiki'

/** Module-table specifiers the shell shares; everything else is inlined. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

export default defineConfig([
  {
    name: `${PACKAGE_NAME}/host`,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: [/^node:/],
      alwaysBundle: () => false,
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
    deps: {
      neverBundle: (specifier: string) => CLIENT_EXTERNALS.includes(specifier),
      alwaysBundle: (specifier: string) => !CLIENT_EXTERNALS.includes(specifier),
      onlyBundle: false,
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    plugins: [{
      name: 'dsh-ip-wiki/client-shape',
      generateBundle(_options, bundle) {
        const files = Object.keys(bundle)
        const extra = files.filter(file => file !== 'client.js')
        if (extra.length > 0) {
          throw new Error(
            `client bundle: ${extra.join(', ')} — this plugin ships no chunk, `
            + 'and a browser factory cannot resolve a sibling file',
          )
        }
        const chunk = bundle['client.js']
        if (chunk === undefined || chunk.type !== 'chunk') {
          throw new Error('client bundle: entry chunk client.js was not emitted')
        }
        const eager = /require\((['"])\.\/[^'"]+\1\)/u.exec(chunk.code)
        if (eager !== null) {
          throw new Error(`client bundle: ${eager[0]} would not resolve in the browser`)
        }
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
