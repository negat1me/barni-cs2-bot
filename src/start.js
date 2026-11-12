import {assertRuntime,loadEnvironment} from './runtime.js';

try {
  assertRuntime();
  loadEnvironment();
  await import('./index.js');
} catch(error) {
  console.error(error.message);
  process.exitCode=1;
}
