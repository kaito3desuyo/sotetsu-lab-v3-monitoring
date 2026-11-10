import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { LocalBundler } from './local-bundler.js';

export interface DependenciesLayerProps {
  /** package.json と package-lock.json があるディレクトリ */
  readonly sourceDir: string;
  readonly layerVersionName: string;
}

export class DependenciesLayer extends Construct {
  readonly layer: lambda.LayerVersion;
  /** 依存を持つ Lambda の buildOptions.external に渡す（'@aws-sdk/*' は呼び側で足す） */
  readonly externals: string[];

  constructor(scope: Construct, id: string, props: DependenciesLayerProps) {
    super(scope, id);
    const { sourceDir, layerVersionName } = props;

    const pkg = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    this.externals = Object.keys(pkg.dependencies ?? {});

    this.layer = new lambda.LayerVersion(this, 'Layer', {
      layerVersionName,
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      compatibleArchitectures: [lambda.Architecture.ARM_64],
      removalPolicy: RemovalPolicy.DESTROY,
      code: lambda.Code.fromAsset(sourceDir, {
        exclude: ['.*', 'node_modules'],
        bundling: {
          local: new LocalBundler(sourceDir),
          image: lambda.Runtime.NODEJS_24_X.bundlingImage,
          platform: 'linux/arm64',
          user: 'root',
          command: [
            'bash',
            '-c',
            'mkdir -p /asset-output/nodejs && cp package.json package-lock.json /asset-output/nodejs/ && npm ci --omit=dev --prefix /asset-output/nodejs',
          ],
        },
      }),
    });
  }
}
