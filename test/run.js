const { execSync } = require('child_process');
try {
  const out = execSync('node "' + __dirname + '\\test.js"', { encoding: 'utf8' });
  const lines = out.split('\n').filter(l => /项|全部|✗/.test(l));
  console.log(lines.join('\n'));
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  console.log(out.split('\n').filter(l => /✗|项|失败清单/.test(l)).join('\n'));
  process.exit(1);
}
