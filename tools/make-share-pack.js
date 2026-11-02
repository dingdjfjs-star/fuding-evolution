// 制作《福鼎城镇演化》离线分享包：拷贝 → PowerShell Compress-Archive（UTF-8 名）→ 校验
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC = 'E:/zcode/玩/福鼎城镇演化';
const STAGE = 'E:/zcode/玩/_staging/福鼎城镇演化';
const OUT = 'E:/zcode/玩/福鼎城镇演化-分享包.zip';
const FILES = ['index.html', 'style.css', 'README.md', 'server.js', '启动.bat'];
const JS = ['boundary.js', 'data.js', 'engine.js', 'realdem.js', 'realrivers.js', 'terrain.js', 'three-view.js', 'titles.js', 'sfx.js', 'ui.js', 'validate.js'];

// 清场
fs.rmSync('E:/zcode/玩/_staging', { recursive: true, force: true });
fs.rmSync(OUT, { force: true });

// 拷贝
fs.mkdirSync(STAGE + '/js', { recursive: true });
fs.mkdirSync(STAGE + '/vendor', { recursive: true });
for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(STAGE, f));
for (const f of JS) fs.copyFileSync(path.join(SRC, 'js', f), path.join(STAGE, 'js', f));
fs.copyFileSync(path.join(SRC, 'vendor/three.min.js'), path.join(STAGE, 'vendor/three.min.js'));

// 清单核对
function listDir(dir, pre) {
  let out = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) out = out.concat(listDir(p, pre + f + '/'));
    else out.push(pre + f + '  (' + (fs.statSync(p).size / 1024).toFixed(0) + 'KB)');
  }
  return out;
}
console.log('暂存清单:');
listDir(STAGE, '福鼎城镇演化/').forEach(l => console.log('  ' + l));

// 压缩（PowerShell Compress-Archive：非 ASCII 名自动带 UTF-8 标志）
execSync('powershell -NoProfile -Command "Compress-Archive -Path \'E:/zcode/玩/_staging/福鼎城镇演化\' -DestinationPath \'E:/zcode/玩/福鼎城镇演化-分享包.zip\' -Force"', { stdio: 'inherit' });

// 校验 zip：条目名、UTF-8 标志
const buf = fs.readFileSync(OUT);
console.log('\n包大小:', (buf.length / 1024).toFixed(0), 'KB');
let names = [], utf8 = 0;
for (let i = buf.length - 22; i >= 0; i--) {
  if (buf.readUInt32LE(i) === 0x06054b50) {
    const n = buf.readUInt16LE(i + 10);
    let off = buf.readUInt32LE(i + 16);
    for (let k = 0; k < n; k++) {
      const flag = buf.readUInt16LE(off + 8), len = buf.readUInt16LE(off + 28);
      names.push(buf.toString('utf8', off + 46, off + 46 + len));
      if (flag & 0x800) utf8++;
      off += 46 + len + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
    }
    break;
  }
}
console.log('条目数:', names.length, '| UTF-8 名标志:', utf8 + '/' + names.length);
console.log(names.join('\n'));

// 试解压核对（PowerShell Expand-Archive 到临时目录）
fs.rmSync('E:/zcode/玩/_staging/_check', { recursive: true, force: true });
execSync('powershell -NoProfile -Command "Expand-Archive -Path \'E:/zcode/玩/福鼎城镇演化-分享包.zip\' -DestinationPath \'E:/zcode/玩/_staging/_check\'"', { stdio: 'ignore' });
const okIndex = fs.existsSync('E:/zcode/玩/_staging/_check/福鼎城镇演化/index.html');
const okBat = fs.existsSync('E:/zcode/玩/_staging/_check/福鼎城镇演化/启动.bat');
const okThree = fs.existsSync('E:/zcode/玩/_staging/_check/福鼎城镇演化/vendor/three.min.js');
console.log('\n试解压: index.html', okIndex, '| 启动.bat', okBat, '| three.min.js', okThree);
console.log(okIndex && okBat && okThree ? '分享包 OK ✓' : '分享包异常 ✗');
process.exit(okIndex && okBat && okThree ? 0 : 1);
