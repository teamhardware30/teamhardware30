import { readFileSync } from 'fs';
import { join } from 'path';

const cache = new Map<string, string>();

export function renderPrompt(promptName: string, vars: Record<string, string>): string {
  let template = cache.get(promptName);
  if (template === undefined) {
    const path = join(__dirname, 'prompts', `${promptName}.md`);
    template = readFileSync(path, 'utf-8');
    cache.set(promptName, template);
  }

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
  );
}
