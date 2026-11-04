/**
 * 图片工具：EXIF 剥离 + 等比缩放。
 *
 * 明文图片（头像等）上传前用 canvas 重绘重编码——重编码后的图片
 * 不携带原图的 GPS 等 EXIF 元数据，从源头阻断位置隐私外泄。
 * 加密附件不经过这里（内容已整体加密，EXIF 随密文一起不可读）。
 */

interface ImageInfo {
  width: number;
  height: number;
}

function getImageInfo(src: string): Promise<ImageInfo> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: (res) => resolve({ width: res.width, height: res.height }),
      fail: reject
    });
  });
}

/**
 * 用离屏 canvas 重绘图片，剥离 EXIF 并等比缩放到 maxSide 以内。
 * @returns 重编码后的临时文件路径（jpg）。
 */
export async function stripExif(src: string, maxSide = 512): Promise<string> {
  const info = await getImageInfo(src);
  const scale = Math.min(1, maxSide / Math.max(info.width, info.height));
  const width = Math.max(1, Math.round(info.width * scale));
  const height = Math.max(1, Math.round(info.height * scale));

  const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
  const ctx = canvas.getContext('2d');
  const image = canvas.createImage();

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('图片加载失败'));
    image.src = src;
  });

  ctx.drawImage(image, 0, 0, width, height);

  return new Promise<string>((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'jpg',
      quality: 0.9,
      success: (res) => resolve(res.tempFilePath),
      fail: reject
    });
  });
}
