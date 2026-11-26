'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import deploymentDefaults from '../../../backend/deployment-defaults.json';

export interface PlatformBranding {
  platformName: string;
  websiteUrl: string;
  repositoryUrl: string;
  logoUrl: string;
  iconUrl: string;
  pwaIcon192Url: string;
  pwaIcon512Url: string;
  pwaMaskableIcon512Url: string;
  platformVersion: string;
}

const DEFAULT_PLATFORM_BRANDING: PlatformBranding = {
  platformName: deploymentDefaults.platformName,
  ...deploymentDefaults.branding,
  platformVersion: '0.0.0',
};

const BrandContext = createContext<PlatformBranding>(DEFAULT_PLATFORM_BRANDING);

/**
 * 规范化后端下发的品牌配置，避免异常响应破坏页面标题或图片地址。
 * @param value 后端配置接口返回的未知品牌字段。
 * @returns 包含默认回退值的可渲染品牌配置。
 */
function normalizeBranding(value: unknown): PlatformBranding {
  const source = value && typeof value === 'object' ? value as Partial<PlatformBranding> : {};
  const branding = { ...DEFAULT_PLATFORM_BRANDING };
  for (const key of Object.keys(branding) as (keyof PlatformBranding)[]) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) branding[key] = value.trim();
  }
  return branding;
}

/**
 * 同步浏览器标签标题和现有站点图标链接。
 * @param branding 当前生效的平台品牌配置。
 * @returns 无返回值，直接更新浏览器文档节点。
 */
function applyDocumentBranding(branding: PlatformBranding): void {
  document.title = branding.platformName;
  const iconLinks = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
  iconLinks.forEach(link => { link.href = branding.iconUrl; });
  const appleIcons = document.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  appleIcons.forEach(link => { link.href = branding.pwaIcon192Url; });
}

/**
 * 加载运行时品牌配置，并向页面组件提供统一的名称与图片地址。
 * @param props 组件子节点。
 * @returns 包含品牌上下文的 React 元素。
 */
export function BrandProvider({ children }: { children: React.ReactNode }) {
  const [branding, setBranding] = useState<PlatformBranding>(DEFAULT_PLATFORM_BRANDING);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/flyreq/config', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('品牌配置请求失败')))
      .then((data: { branding?: unknown }) => {
        if (cancelled) return;
        setBranding(normalizeBranding(data.branding));
      })
      .catch(() => {
        if (!cancelled) setBranding(DEFAULT_PLATFORM_BRANDING);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    applyDocumentBranding(branding);
  }, [branding]);

  const value = useMemo(() => branding, [branding]);
  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

/**
 * 获取当前平台品牌配置。
 * @returns 当前生效的平台名称、Logo、站点图标地址与展示版本号。
 */
export function useBranding(): PlatformBranding {
  return useContext(BrandContext);
}
