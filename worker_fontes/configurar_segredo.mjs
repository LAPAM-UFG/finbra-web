import { createHash, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
if (!process.env.R2_SECRET_ACCESS_KEY) throw Error('Credencial de coleta ausente');
const token = createHmac('sha256', process.env.R2_SECRET_ACCESS_KEY).update('finbra-fontes-v1').digest('hex');
const hash = createHash('sha256').update(token).digest('hex');
execFileSync(process.execPath, [resolve('worker/node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', 'FONTE_TOKEN_SHA256', '--config', resolve('worker_fontes/wrangler.jsonc')], { input: hash + '\n', stdio: ['pipe', 'inherit', 'inherit'] });
