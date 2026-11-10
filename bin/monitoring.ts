import { App } from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import { loadConfig } from '../lib/config.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

const app = new App();
const stage = app.node.tryGetContext('STAGE') as string | undefined;
if (stage) {
  dotenv.config({ path: `.env.${stage}` });
}
const config = loadConfig(stage, process.env);

new MonitoringStack(app, config.resourceNames.stack, {
  stackName: config.resourceNames.stack,
  env: { account: config.account, region: config.region },
  config,
});
