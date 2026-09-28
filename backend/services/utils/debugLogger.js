// backend/services/utils/debugLogger.js
import fs from 'node:fs';
import path from 'node:path';

export function save(name, content) {
  const dir = path.join(process.cwd(), 'tmp-debug');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name}.xml`);
  fs.writeFileSync(file, content);
  return file;
}
