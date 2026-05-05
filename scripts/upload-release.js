const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 读取版本号
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const version = packageJson.version;
const vsixFile = `windsurf-pool-${version}.vsix`;

// 检查 vsix 文件是否存在
const vsixPath = path.join(__dirname, '..', vsixFile);
if (!fs.existsSync(vsixPath)) {
  console.error(`Error: ${vsixFile} not found`);
  process.exit(1);
}

console.log(`Uploading ${vsixFile} to public release repo...`);

try {
  // 上传到公开仓库
  execSync(`gh release create v${version} ${vsixFile} --repo soulvon/windsurf-pool-releases --title "v${version}" --notes "Release v${version}"`, {
    stdio: 'inherit'
  });
  console.log(`✓ Uploaded to https://github.com/soulvon/windsurf-pool-releases/releases/tag/v${version}`);
} catch (err) {
  console.error('Upload failed:', err.message);
  process.exit(1);
}
