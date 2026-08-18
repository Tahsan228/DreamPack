/**
 * Hand a file to the browser.
 *
 * The object URL is revoked on a timer rather than immediately: the click is
 * asynchronous, and revoking in the same tick cancels the download in some
 * browsers before it has read the blob.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBytes(
  bytes: Uint8Array | string,
  filename: string,
  mime: string,
): void {
  const blob = typeof bytes === 'string'
    ? new Blob([bytes], { type: mime })
    : new Blob([new Uint8Array(bytes)], { type: mime });
  downloadBlob(blob, filename);
}
