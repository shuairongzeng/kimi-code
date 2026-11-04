import type { ProviderMediaContribution } from '#/media/upload';
import { modelKey, type LlmModel } from '#/llm-requester/model';

import { ZimiFiles } from './files';
import { ZIMI_DEFAULT_BASE_URL } from '#/llm/builtin/provider/zimi/index';

const filesByModel = new Map<string, ZimiFiles>();

function resolveFiles(model: LlmModel): ZimiFiles {
  const key = modelKey(model);
  let files = filesByModel.get(key);
  if (files === undefined) {
    files = new ZimiFiles({
      apiKey: model.apiKey,
      baseUrl: model.baseUrl ?? ZIMI_DEFAULT_BASE_URL,
      defaultHeaders:
        model.defaultHeaders === undefined ? undefined : { ...model.defaultHeaders },
    });
    filesByModel.set(key, files);
  }
  return files;
}

export const zimiMediaContribution: ProviderMediaContribution = {
  uploadVideo: (video, { model, signal }) => resolveFiles(model).uploadVideo(video, { signal }),
};
