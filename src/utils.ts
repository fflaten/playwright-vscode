/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import which from 'which';

export function calculateSha1(buffer: Buffer | string): string {
  const hash = crypto.createHash('sha1');
  hash.update(buffer);
  return hash.digest('hex');
}

export function createGuid(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function ansiToHtml(text: string): string {
  let isOpen = false;
  let hasTags = false;
  const tokens: string[] = [];
  for (let i = 0; i < text.length; ++i) {
    const c = text.charAt(i);
    if (c === '\u001b') {
      hasTags = true;
      const end = text.indexOf('m', i + 1);
      const code = text.substring(i + 1, end);
      if (!code.match(/\[\d+/))
        continue;
      if (isOpen) {
        tokens.push('</span>');
        isOpen = false;
      }
      switch (code) {
        case '[2': {
          tokens.push(`<span style='color:#666;'>`);
          isOpen = true;
          break;
        }
        case '[22': break;
        case '[31': {
          tokens.push(`<span style='color:#f14c4c;'>`);
          isOpen = true;
          break;
        }
        case '[32': {
          tokens.push(`<span style='color:#73c991;'>`);
          isOpen = true;
          break;
        }
        case '[39': break;
      }
      i = end;
    } else {
      if (c === '\n') {
        // Don't close to work around html parsing bug.
        tokens.push('\n<br>\n');
      } else if (c === ' ') {
        tokens.push('&nbsp;');
      } else {
        tokens.push(escapeHTML(c));
      }
    }
  }
  // Work around html parsing bugs.
  if (hasTags)
    tokens.push('\n</span></br>');
  return tokens.join('');
}

function escapeHTML(text: string): string {
  return text.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '<b>&lt;</b>', '>': '<b>&gt;</b>' }[c]!));
}

export async function spawnAsync(executable: string, args: string[], cwd?: string): Promise<string> {
  const childProcess = spawn(executable, args, {
    stdio: 'pipe',
    cwd,
    env: { ...process.env }
  });
  let output = '';
  childProcess.stdout.on('data', data => output += data.toString());
  return new Promise<string>((f, r) => {
    childProcess.on('error', error => r(error));
    childProcess.on('exit', () => f(output));
  });
}

export async function resolveSourceMap(file: string, fileToSources: Map<string, string[]>, sourceToFile: Map<string, string>): Promise<string[]> {
  if (!file.endsWith('.js'))
    return [file];
  const cached = fileToSources.get(file);
  if (cached)
    return cached;

  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });

  let lastLine: string | undefined;
  rl.on('line', line => {
    lastLine = line;
  });
  await new Promise(f => rl.on('close', f));

  if (lastLine?.startsWith('//# sourceMappingURL=')) {
    const sourceMappingFile = path.resolve(path.dirname(file), lastLine.substring('//# sourceMappingURL='.length));
    try {
      const sourceMapping = await fs.promises.readFile(sourceMappingFile, 'utf-8');
      const sources = JSON.parse(sourceMapping).sources;
      const sourcePaths = sources.map((s: string) => {
        const source = path.resolve(path.dirname(sourceMappingFile), s);
        sourceToFile.set(source, file);
        return source;
      });
      fileToSources.set(file, sourcePaths);
      return sourcePaths;
    } catch (e) {
    }
  }
  fileToSources.set(file, [file]);
  return [file];
}

let pathToNodeJS: string | undefined;

export async function findNode(): Promise<string> {
  if (pathToNodeJS)
    return pathToNodeJS;

  let node = await which('node');
  // When extension host boots, it does not have the right env set, so we might need to wait.
  for (let i = 0; i < 5 && !node; ++i) {
    await new Promise(f => setTimeout(f, 1000));
    node = await which('node');
  }
  if (!node)
    throw new Error('Unable to launch `node`, make sure it is in your PATH');
  pathToNodeJS = node;
  return node;
}
