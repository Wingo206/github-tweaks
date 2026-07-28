import type {
  BackgroundRequest,
  BackgroundResponse,
} from './types';

export async function sendBackgroundMessage<T>(
  request: BackgroundRequest,
): Promise<T> {
  const response = (await browser.runtime.sendMessage(
    request,
  )) as BackgroundResponse<T>;

  if (!response?.ok) {
    throw new Error(response?.error || 'The extension background worker failed.');
  }

  return response.data as T;
}
