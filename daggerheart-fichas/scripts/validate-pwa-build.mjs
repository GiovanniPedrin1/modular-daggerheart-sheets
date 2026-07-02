import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const distDir = resolve('dist');
const swPath = join(distDir, 'sw.js');

if (!existsSync(swPath)) {
  console.error('Erro: dist/sw.js não encontrado.');
  process.exit(1);
}

const swContent = readFileSync(swPath, 'utf8');

const urls = [
  ...swContent.matchAll(/url:\s*["']([^"']+)["']/g),
].map((match) => match[1]);

let hasError = false;

for (const url of urls) {
  if (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:')
  ) {
    continue;
  }

  const cleanUrl = url.replace(/^\//, '').split('?')[0];
  const filePath = join(distDir, cleanUrl);

  if (!existsSync(filePath)) {
    console.error(`Arquivo referenciado no sw.js não existe: ${url}`);
    hasError = true;
  }
}

if (hasError) {
  process.exit(1);
}

console.log('Build PWA validada: todos os arquivos do precache existem.');