import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
export function assertRuntime(version=process.versions.node) {
  const [major,minor]=version.split('.').map(Number);
  if(!(major>22 || major===22&&minor>=13))throw new Error(`Потрібен Node.js 22.13+; зараз ${version} (${process.execPath}). Онови Node.js для запуску бота.`);
}
export function loadEnvironment(root=projectRoot) {
  try { process.loadEnvFile(join(root,'.env')); }
  catch(error) { if(error.code!=='ENOENT')throw error; }
}
