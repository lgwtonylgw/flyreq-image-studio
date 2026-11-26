/**
 * 从品牌源图生成站点图标和 PWA 安装图标。
 * 用法：node scripts/generate-icons.js [品牌源图路径]
 */
const path = require('node:path');
const { createRequire } = require('node:module');
const { branding } = require('../backend/deployment-defaults.json');

const root = path.resolve(__dirname, '..');
const requireBackend = createRequire(path.join(root, 'backend', 'package.json'));
const sharp = requireBackend('sharp');
const publicDir = path.join(root, 'frontend', 'public');
const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(publicDir, 'brand', 'token-ai-gate', 'token-ai-gate.svg');

/**
 * 生成默认品牌的各尺寸 PNG，确保可遮罩图标包含安全边距。
 * @returns 图标全部写入后完成的 Promise。
 */
async function generateIcons() {
  for (const [url, edge] of [[branding.logoUrl, 128], [branding.pwaIcon192Url, 192], [branding.pwaIcon512Url, 512]]) {
    await sharp(source).resize(edge, edge, { fit: 'contain', background: 'transparent' }).png().toFile(path.join(publicDir, url));
  }
  const maskable = await sharp(source).resize(408, 408, { fit: 'contain', background: 'transparent' }).png().toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1734' } })
    .composite([{ input: maskable, gravity: 'centre' }]).png().toFile(path.join(publicDir, branding.pwaMaskableIcon512Url));
  await sharp(source).resize(64, 64, { fit: 'contain', background: 'transparent' }).png()
    .toFile(path.join(root, 'frontend', 'src', 'app', 'favicon.png'));
}

generateIcons().catch(error => {
  console.error('图标生成失败：', error.message);
  process.exitCode = 1;
});
