import { resolve } from 'node:path';
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
});
