export async function getUploadErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length > 0) return body.error;
    } catch {
      // Fall through to status-based fallback below.
    }
  }

  return `Upload failed (${response.status})`;
}
