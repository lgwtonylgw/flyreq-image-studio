import { afterEach, describe, expect, it } from 'vitest';
import {
  applyDeploymentDefaultImageModel,
  applyDeploymentDefaultVideoModel,
  loadRegistry,
  saveRegistry,
} from '@/lib/flyreq-models';
import { LOCAL_STORAGE_KEYS } from '@/lib/storage-contract';

describe('部署级首次图片模型配置', () => {
  afterEach(() => {
    localStorage.clear();
    applyDeploymentDefaultImageModel();
    applyDeploymentDefaultVideoModel();
  });

  it('在没有本地注册表时应用部署级默认模型并默认开启流式请求', () => {
    applyDeploymentDefaultImageModel({
      id: 'deployment-image',
      protocol: 'openai',
      name: 'Deployment Image',
      modelId: 'deployment-model',
      usesPresetModelId: false,
      baseUrl: 'https://images.example.com',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 8,
      maxOutputSize: '2K',
      supportsAdvancedParams: true,
      supportsTemperature: false,
      streamImages: true,
    });

    const registry = loadRegistry();
    expect(registry.imageModels).toEqual([expect.objectContaining({
      id: 'deployment-image',
      name: 'Deployment Image',
      modelId: 'deployment-model',
      baseUrl: 'https://images.example.com',
      streamImages: true,
    })]);
  });

  it('不覆盖用户已经保存的图片模型配置', () => {
    const registry = loadRegistry();
    saveRegistry({
      ...registry,
      imageModels: [{
        id: 'user-image',
        protocol: 'openai',
        name: 'User Image',
        modelId: 'user-model',
        apiKey: 'user-key',
        baseUrl: 'https://user.example.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 4,
        maxOutputSize: '1K',
        supportsAdvancedParams: false,
        supportsTemperature: false,
        streamImages: false,
      }],
      textModels: [],
      defaults: {
        ...registry.defaults,
        textToImage: 'user-image',
        imageToImage: 'user-image',
        reversePrompt: '',
        agent: '',
        promptOptimize: '',
        imageDescribe: '',
      },
    });
    applyDeploymentDefaultImageModel({ id: 'deployment-image', name: 'Deployment Image' });

    expect(loadRegistry().imageModels).toEqual([expect.objectContaining({
      id: 'user-image',
      name: 'User Image',
      streamImages: false,
    })]);
  });

  it('只替换未绑定密钥的旧内置端点，并保留模型能力和已有密钥', () => {
    const registry = loadRegistry();
    const legacyImage = {
      ...registry.imageModels[0],
      name: 'FlyReq',
      baseUrl: 'https://flyreq.com/',
      maxOutputSize: '2K',
    };
    const legacyVideo = {
      ...registry.videoModels[0],
      name: 'FlyReq',
      baseUrl: 'https://flyreq.com',
    };
    localStorage.setItem(LOCAL_STORAGE_KEYS.modelRegistry, JSON.stringify({
      ...registry,
      imageModels: [legacyImage],
      videoModels: [legacyVideo],
    }));

    const upgraded = loadRegistry();
    expect(upgraded.imageModels[0]).toMatchObject({
      id: legacyImage.id, name: 'Token AI Gate', baseUrl: 'https://api.tokenaigate.com', apiKey: '', maxOutputSize: '2K',
    });
    expect(upgraded.videoModels[0]).toMatchObject({
      id: legacyVideo.id, name: 'Token AI Gate', baseUrl: 'https://api.tokenaigate.com', apiKey: '',
    });

    localStorage.setItem(LOCAL_STORAGE_KEYS.modelRegistry, JSON.stringify({
      ...registry,
      imageModels: [{ ...legacyImage, apiKey: 'existing-key' }],
      videoModels: [{ ...legacyVideo, apiKey: 'existing-video-key' }],
    }));
    const configured = loadRegistry();
    expect(configured.imageModels[0]).toMatchObject({ baseUrl: legacyImage.baseUrl, apiKey: 'existing-key' });
    expect(configured.videoModels[0]).toMatchObject({ baseUrl: legacyVideo.baseUrl, apiKey: 'existing-video-key' });
  });
});
