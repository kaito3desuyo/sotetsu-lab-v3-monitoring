import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { ILocalBundling } from 'aws-cdk-lib';

export class LocalBundler implements ILocalBundling {
  constructor(private readonly rootDir: string) {}

  tryBundle(outputDir: string): boolean {
    try {
      execFileSync(resolve(import.meta.dirname, 'bundle.sh'), {
        env: {
          ...process.env,
          BUNDLER_OUTPUT_DIR: outputDir,
          BUNDLER_ROOT_DIR: this.rootDir,
        },
        timeout: 60_000,
        encoding: 'utf-8',
      });
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  }
}
