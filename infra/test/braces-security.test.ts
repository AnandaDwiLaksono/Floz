import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(__dirname, '../..');
const webRequire = createRequire(resolve(root, 'apps/web/package.json'));
const pluginRequire = createRequire(webRequire.resolve('@next/eslint-plugin-next'));
const globRequire = createRequire(pluginRequire.resolve('fast-glob'));
const matchRequire = createRequire(globRequire.resolve('micromatch'));
type Node = { type: string; nodes?: Node[]; parent?: Node; value?: string };
type Braces = ((pattern: string, options?: { expand?: boolean }) => string[]) & {
  parse(pattern: string): Node;
  compile(input: string | Node): string;
  expand(input: string | Node): string[];
  stringify(input: string | Node): string;
};
const braces = matchRequire('braces') as Braces;
const compile = matchRequire('braces/lib/compile') as (ast: Node) => string;
const expand = matchRequire('braces/lib/expand') as (ast: Node) => string[];
const stringify = matchRequire('braces/lib/stringify') as (ast: Node) => string;
const { flatten } = matchRequire('braces/lib/utils') as { flatten(value: unknown): unknown[] };

const nestedAst = (levels: number): Node => {
  const root: Node = { type: 'root', nodes: [] };
  let parent = root;
  for (let i = 0; i < levels; i++) {
    const child: Node = { type: 'paren', nodes: [], parent };
    parent.nodes = [child];
    parent = child;
  }
  parent.nodes = [{ type: 'text', value: 'x', parent }];
  return root;
};

describe('GHSA-vfj7-8cjw-p6xm local mitigation', () => {
  test('bounds nested array values in flatten and both append branches', () => {
    let value: unknown = 'x';
    for (let i = 0; i < 4000; i++) value = [value];
    const text = { type: 'text', value };
    for (const nodes of [[text], [text, { type: 'text', value: 'y' }], [{ type: 'text', value: 'y' }, text]]) {
      expect(() => expand({ type: 'root', nodes } as unknown as Node)).toThrow('Pattern nesting exceeds maximum depth (256)');
    }
    expect(() => flatten(value)).toThrow('Pattern nesting exceeds maximum depth (256)');
    expect(flatten([['a'], ['b']])).toEqual(['a', 'b']);
  });

  test('bounds mixed, dollar and unclosed patterns through every public entry point', () => {
    for (const pattern of ['{('.repeat(2000) + 'a' + ')}'.repeat(2000), '${'.repeat(3000) + 'a' + '}'.repeat(3000), '{'.repeat(4000) + 'a']) {
      for (const run of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
        expect(() => run(pattern)).toThrow('Pattern nesting exceeds maximum depth (256)');
      }
    }
  });

  test('bounds cyclic AST children and array values', () => {
    for (const run of [compile, expand, stringify]) {
      const ast: Node = { type: 'paren', nodes: [] };
      ast.nodes!.push(ast);
      expect(() => run(ast)).toThrow('Pattern nesting exceeds maximum depth (256)');
    }
    const array: unknown[] = [];
    array.push(array);
    expect(() => flatten(array)).toThrow('Pattern nesting exceeds maximum depth (256)');
  });

  test('preserves normal glob compilation and expansion', () => {
    expect(braces('src/{app,lib}/*.ts', { expand: true })).toEqual(['src/app/*.ts', 'src/lib/*.ts']);
  });

  for (const expand of [false, true]) {
    test(`rejects excessive brace nesting before recursive walking (expand=${expand})`, () => {
      const pattern = '{'.repeat(4000) + 'a,b' + '}'.repeat(4000);
      expect(() => braces(pattern, { expand })).toThrow('Pattern nesting exceeds maximum depth (256)');
    });
  }

  test('also bounds parentheses nesting used by recursive AST walkers', () => {
    expect(() => braces('('.repeat(4000) + 'a' + ')'.repeat(4000))).toThrow('Pattern nesting exceeds maximum depth (256)');
  });

  test('preserves normal entry points on parsed ASTs', () => {
    expect(braces.compile(braces.parse('{a,b}'))).toBe('(a|b)');
    expect(braces.expand(braces.parse('{a,b}'))).toEqual(['a', 'b']);
    expect(braces.stringify(braces.parse('{a,b}'))).toBe('{a,b}');
  });

  for (const [name, run] of [
    ['compile', braces.compile], ['expand', braces.expand], ['stringify', braces.stringify],
    ['lib/compile', compile], ['lib/expand', expand], ['lib/stringify', stringify]
  ] as const) {
    test(`${name} rejects deep caller-supplied ASTs without stack overflow`, () => {
      expect(() => run(nestedAst(4000))).toThrow('Pattern nesting exceeds maximum depth (256)');
    });
  }

  for (const entry of ['public', 'lib/expand'] as const) {
    for (const shape of ['self', 'two-node', 'deep'] as const) {
      test(`${entry} rejects ${shape} parent links without hanging`, () => {
        const script = `
          const braces = require(${JSON.stringify(matchRequire.resolve('braces'))});
          const run = ${entry === 'public' ? 'braces.expand' : `require(${JSON.stringify(matchRequire.resolve('braces/lib/expand'))})`};
          const root = { type: 'root', nodes: [] };
          const child = { type: 'paren', nodes: [], parent: root };
          root.nodes.push(child);
          if (${JSON.stringify(shape)} === 'self') child.parent = child;
          if (${JSON.stringify(shape)} === 'two-node') {
            const other = { type: 'paren', nodes: [], parent: child };
            child.parent = other;
          }
          if (${JSON.stringify(shape)} === 'deep') {
            let parent = child;
            for (let i = 0; i < 300; i++) parent = { type: 'paren', parent };
            child.parent = parent;
          }
          try { run(root); process.exit(2); }
          catch (error) {
            if (error instanceof RangeError && error.message === 'Pattern nesting exceeds maximum depth (256)') process.exit(0);
            console.error(error); process.exit(3);
          }
        `;
        const result = spawnSync(process.execPath, ['-e', script], { timeout: 3000, encoding: 'utf8' });
        expect(result.error?.message).toBeUndefined();
        expect(result.status, result.stderr).toBe(0);
      });
    }
  }
});
