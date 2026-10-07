// Runs the API server and the Vite dev server side by side with prefixed output.
import { spawn } from 'node:child_process';

const tasks = [
  { name: 'server', color: '\x1b[34m', command: 'npm run dev -w server' },
  { name: 'client', color: '\x1b[35m', command: 'npm run dev -w client' },
];

const children = tasks.map(({ name, color, command }) => {
  const child = spawn(command, { shell: true, stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const prefix = `${color}[${name}]\x1b[0m `;
  const pipe = (stream, target) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) target.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
