export async function downloadImage(
  src: string,
  onDownloaded?: (src: string) => void
) {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'image.png';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    onDownloaded?.(src);
  } catch (err) {
    console.error('Failed to download image:', err);
  }
}

export async function downloadBatch(
  sources: string[],
  onDownloaded?: (src: string) => void
) {
  for (const src of sources) {
    await downloadImage(src, onDownloaded);
  }
}
