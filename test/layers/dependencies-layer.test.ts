import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { DependenciesLayer } from '../../lib/layers/dependencies-layer.js';

const sourceDir = resolve(import.meta.dirname, 'fixture');

describe('DependenciesLayer', () => {
  it('レイヤーをテンプレートに出す', () => {
    const stack = new Stack(new App(), 'Test');
    new DependenciesLayer(stack, 'Layer', { sourceDir, layerVersionName: 'test-layer' });
    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::LayerVersion', 1);
    template.hasResourceProperties('AWS::Lambda::LayerVersion', {
      CompatibleRuntimes: ['nodejs24.x'],
      CompatibleArchitectures: ['arm64'],
    });
  }, 90_000);

  it('externals は dependencies のキー', () => {
    const stack = new Stack(new App(), 'Test');
    const layer = new DependenciesLayer(stack, 'Layer', { sourceDir, layerVersionName: 'test-layer' });
    expect(layer.externals).toEqual(['ms']);
  });

  describe('アセットのハッシュ', () => {
    const synthKey = (dir: string): string => {
      const stack = new Stack(new App(), 'Test');
      new DependenciesLayer(stack, 'Layer', { sourceDir: dir, layerVersionName: 'test-layer' });
      const layers = Template.fromStack(stack).findResources('AWS::Lambda::LayerVersion');
      return JSON.stringify(Object.values(layers)[0].Properties.Content);
    };
    const copyFixture = () => {
      const dir = mkdtempSync(join(tmpdir(), 'layer-hash-'));
      cpSync(sourceDir, dir, { recursive: true });
      return dir;
    };

    it('依存の定義以外のファイルを足しても変わらない', () => {
      const dir = copyFixture();
      const before = synthKey(dir);
      writeFileSync(join(dir, 'handler.ts'), 'export const a = 1;\n');
      expect(synthKey(dir)).toBe(before);
    }, 90_000);

    it('package.json を変えると変わる', () => {
      const dir = copyFixture();
      const before = synthKey(dir);
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'layer-fixture', version: '1.0.0', private: true, description: 'x', dependencies: { ms: '2.1.3' } }),
      );
      expect(synthKey(dir)).not.toBe(before);
    }, 90_000);
  });
});
