import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import deploymentDefaults from '../../../../backend/deployment-defaults.json';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(
  path.resolve(testDir, '../../../../backend/server.js'),
  'utf8',
);

describe('后端平台品牌配置', () => {
  it('从环境变量分别读取平台名称、Logo、favicon 和 PWA 图标地址', () => {
    expect(serverSource).toContain('FLYREQ_PLATFORM_NAME');
    expect(serverSource).toContain('FLYREQ_PLATFORM_LOGO_URL');
    expect(serverSource).toContain('FLYREQ_PLATFORM_ICON_URL');
    expect(serverSource).toContain('FLYREQ_PLATFORM_WEBSITE_URL');
    expect(serverSource).toContain('FLYREQ_PLATFORM_REPOSITORY_URL');
    expect(serverSource).toContain('FLYREQ_PWA_ICON_192_URL');
    expect(serverSource).toContain('FLYREQ_PWA_ICON_512_URL');
    expect(serverSource).toContain('FLYREQ_PWA_MASKABLE_ICON_512_URL');
    expect(serverSource).toContain('process.env.APP_VERSION');
    expect(serverSource).toContain('function resolvePlatformBranding(env = getRuntimeEnv())');
  });

  it('随镜像提供安装图标，并与静态回退清单的图标地址和尺寸一致', () => {
    const publicDir = path.resolve(testDir, '../../../public');
    const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, 'manifest.json'), 'utf8'));
    const { branding } = deploymentDefaults;
    const icons = [
      [branding.pwaIcon192Url, 192],
      [branding.pwaIcon512Url, 512],
      [branding.pwaMaskableIcon512Url, 512],
    ] as const;
    expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(icons.map(([url]) => url));
    for (const [url, size] of icons) {
      const png = fs.readFileSync(path.join(publicDir, url));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });

  it('将品牌配置下发给页面和动态 PWA Manifest', () => {
    expect(serverSource).toContain('branding: resolvePlatformBranding(env)');
    expect(serverSource).toContain("'/api/flyreq/manifest.webmanifest'");
    expect(serverSource).toContain('buildPlatformManifest(resolvePlatformBranding(getRuntimeEnv()))');
    expect(serverSource).toContain("{ src: branding.pwaIcon192Url, sizes: '192x192', type: 'image/png', purpose: 'any' }");
    expect(serverSource).toContain("{ src: branding.pwaIcon512Url, sizes: '512x512', type: 'image/png', purpose: 'any' }");
    expect(serverSource).toContain("{ src: branding.pwaMaskableIcon512Url, sizes: '512x512', type: 'image/png', purpose: 'maskable' }");
  });
});
