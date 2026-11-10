import { App } from 'aws-cdk-lib';
import * as dotenv from 'dotenv';
import { loadConfig } from '../lib/config.js';

const app = new App();
const stage = app.node.tryGetContext('STAGE') as string | undefined;
if (stage) {
  dotenv.config({ path: `.env.${stage}` });
}
loadConfig(stage, process.env);
