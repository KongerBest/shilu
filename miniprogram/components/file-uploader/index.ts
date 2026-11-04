import { attachmentService, type AttachmentBiz, type AttachmentRole } from '../../services/attachment.service';
import { initCloud } from '../../services/transport';
import type { Attachment } from '../../types/models';
import { toAppError } from '../../utils/errors';

interface UploadItem extends Attachment {
  /** 临时访问链接，图片用于缩略图、文件用于下载 */
  url: string;
  sizeText: string;
}

interface PickFile {
  path: string;
  name: string;
  size: number;
  mime: string;
  width: number;
  height: number;
}

const MAX_IMAGE = 9;
const MAX_FILE = 5;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

/** 从临时路径里取扩展名；取不到或非法时退回 bin。 */
function extOf(path: string): string {
  const clean = (path || '').split('?')[0];
  const dot = clean.lastIndexOf('.');
  const ext = dot >= 0 ? clean.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

function mimeOf(path: string): string {
  return MIME_BY_EXT[extOf(path)] || 'application/octet-stream';
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function chooseImages(count: number): Promise<PickFile[]> {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        resolve(
          res.tempFiles.map((f) => ({
            path: f.tempFilePath,
            name: '',
            size: f.size,
            mime: mimeOf(f.tempFilePath),
            width: f.width || 0,
            height: f.height || 0
          }))
        );
      },
      fail: reject
    });
  });
}

function chooseDocs(count: number): Promise<PickFile[]> {
  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count,
      type: 'file',
      success: (res) => {
        resolve(
          res.tempFiles.map((f) => ({
            path: f.path,
            name: f.name,
            size: f.size,
            mime: mimeOf(f.name || f.path),
            width: 0,
            height: 0
          }))
        );
      },
      fail: reject
    });
  });
}

/**
 * 附件上传器。
 *
 * 状态机：idle → uploading(progress) → confirming → done | failed。
 * 失败时保留错误文案与重试入口，不静默吞掉；已成功的文件不会重复上传。
 */
Component({
  properties: {
    bizType: { type: String, value: 'record' },
    bizId: { type: String, value: '' },
    role: { type: String, value: 'other' },
    /** image = 只允许图片；file = 只允许文件 */
    accept: { type: String, value: 'image' },
    max: { type: Number, value: 9 },
    readonly: { type: Boolean, value: false }
  },

  data: {
    items: [] as UploadItem[],
    loading: false,
    uploading: false,
    progress: 0,
    error: '',
    acceptImage: true,
    limit: MAX_IMAGE,
    /** 最近一次加载的 biz，用于去重（observer 与 attached 会各触发一次） */
    lastBizId: '',
    /** 请求序号，只有最新一次的结果允许落盘 */
    loadToken: 0
  },

  observers: {
    'bizId, accept, max': function (bizId: string, accept: string, max: number) {
      const acceptImage = accept !== 'file';
      this.setData({
        acceptImage,
        limit: Math.min(max || (acceptImage ? MAX_IMAGE : MAX_FILE), acceptImage ? MAX_IMAGE : MAX_FILE)
      });
      if (bizId) this.scheduleLoad();
    }
  },

  lifetimes: {
    attached() {
      const acceptImage = this.properties.accept !== 'file';
      this.setData({
        acceptImage,
        limit: Math.min(this.properties.max || (acceptImage ? MAX_IMAGE : MAX_FILE), acceptImage ? MAX_IMAGE : MAX_FILE)
      });
      if (this.properties.bizId) this.scheduleLoad();
    }
  },

  methods: {
    /** observer 与 attached 都会触发首次加载，这里按 biz 去重，避免两次并发请求 */
    scheduleLoad() {
      const bizId = this.properties.bizId;
      if (!bizId) return;
      if (this.data.loading && this.data.lastBizId === bizId) return;
      this.setData({ lastBizId: bizId });
      void this.load();
    },

    async load() {
      const bizId = this.properties.bizId;
      if (!bizId) return;
      const token = this.data.loadToken + 1;
      this.setData({ loading: true, error: '', loadToken: token });
      try {
        const res = await attachmentService.listByBiz(this.properties.bizType as AttachmentBiz, bizId);
        if (this.data.loadToken !== token) return;
        // 同一个 biz 上既有图片也有文件：两个实例各取自己那一类，互不干扰
        const acceptImage = this.properties.accept !== 'file';
        const items: UploadItem[] = res.items
          .filter((item) => (item.mime.indexOf('image/') === 0) === acceptImage)
          .map((item) => Object.assign({ url: '', sizeText: humanSize(item.size) }, item));
        this.setData({ items, loading: false });
        await this.refreshUrls();
        this.emitChange();
      } catch (error) {
        if (this.data.loadToken !== token) return;
        this.setData({ loading: false, error: toAppError(error).message });
      }
    },

    /** 图片与文件都需要临时链接；一次性换取，避免每个附件一次云调用。 */
    async refreshUrls() {
      const missing = this.data.items.filter((item) => item.encrypted === 0 && !item.url);
      if (missing.length === 0) return;
      try {
        const res = await attachmentService.reSign(missing.map((item) => item._id));
        const byId: Record<string, string> = {};
        res.items.forEach((signed) => {
          byId[signed.id] = signed.tempUrl;
        });
        const items = this.data.items.map((item) =>
          byId[item._id] ? Object.assign({}, item, { url: byId[item._id] }) : item
        );
        this.setData({ items });
      } catch (error) {
        // 链接失败不影响上传与删除，只是缩略图空着
        this.setData({ error: toAppError(error).message });
      }
    },

    async onAdd() {
      if (this.data.uploading || this.properties.readonly) return;
      const remain = this.data.limit - this.data.items.length;
      if (remain <= 0) {
        wx.showToast({ title: `最多 ${this.data.limit} 个`, icon: 'none' });
        return;
      }

      let files: PickFile[] = [];
      try {
        files = this.data.acceptImage ? await chooseImages(remain) : await chooseDocs(remain);
      } catch (error) {
        // 用户取消选择不算错误
        const msg = toAppError(error).message;
        if (msg.indexOf('cancel') < 0) wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      if (files.length === 0) return;

      await this.uploadAll(files.slice(0, remain));
    },

    async uploadAll(files: PickFile[]) {
      this.setData({ uploading: true, error: '', progress: 0 });
      let failed = 0;

      for (let i = 0; i < files.length; i++) {
        try {
          await this.uploadOne(files[i], this.data.items.length + i + 1);
        } catch (error) {
          failed++;
          this.setData({ error: toAppError(error).message });
        }
      }

      this.setData({ uploading: false, progress: 0 });
      await this.load();
      if (failed > 0) {
        wx.showToast({ title: `${failed} 个上传失败`, icon: 'none' });
      }
    },

    async uploadOne(file: PickFile, ordinal: number) {
      initCloud();
      const bizId = this.properties.bizId;
      if (!bizId) throw new Error('缺少业务 id');

      const ext = extOf(file.path || file.name);
      const prep = await attachmentService.prepareUpload({
        bizType: this.properties.bizType as AttachmentBiz,
        bizId,
        role: this.properties.role as AttachmentRole,
        ext
      });

      if (file.size > prep.maxSize) {
        throw new Error(`单个文件不能超过 ${Math.floor(prep.maxSize / 1024 / 1024)}MB`);
      }

      const uploaded = await new Promise<{ fileID: string }>((resolve, reject) => {
        const task = wx.cloud.uploadFile({
          cloudPath: prep.cloudPath,
          filePath: file.path,
          success: (res) => resolve({ fileID: res.fileID }),
          fail: reject
        });
        // 进度回调挂在 UploadTask 上，不是入参
        task.onProgressUpdate((res: { progress: number }) => {
          this.setData({ progress: res.progress });
        });
      });

      await attachmentService.confirmUpload({
        bizType: this.properties.bizType as AttachmentBiz,
        bizId,
        role: this.properties.role as AttachmentRole,
        fileId: uploaded.fileID,
        nameMask: this.data.acceptImage ? `图片 ${ordinal}` : (file.name || `附件 ${ordinal}`).slice(0, 60),
        mime: file.mime,
        size: file.size,
        width: file.width || null,
        height: file.height || null
      });
    },

    async onPreview(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item) return;
      if (!item.url) await this.refreshUrls();
      const urls = this.data.items.filter((it) => it.url).map((it) => it.url);
      const current = this.data.items[index] && this.data.items[index].url;
      if (urls.length === 0) return;
      wx.previewImage({ urls, current: current || urls[0] });
    },

    onRemove(e: WechatMiniprogram.TouchEvent) {
      const id = String(e.currentTarget.dataset.id || '');
      if (!id || this.properties.readonly) return;
      wx.showModal({
        title: '删除附件',
        content: '删除后不可恢复，确定继续？',
        success: async (res) => {
          if (!res.confirm) return;
          try {
            await attachmentService.remove(id);
            await this.load();
            wx.showToast({ title: '已删除', icon: 'none' });
          } catch (error) {
            wx.showToast({ title: toAppError(error).message, icon: 'none' });
          }
        }
      });
    },

    onFileTap(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item || !item.url) return;
      wx.showLoading({ title: '打开中' });
      wx.downloadFile({
        url: item.url,
        success: (res) => {
          wx.hideLoading();
          if (res.statusCode !== 200) {
            wx.showToast({ title: '下载失败', icon: 'none' });
            return;
          }
          wx.openDocument({
            filePath: res.tempFilePath,
            showMenu: true,
            fail: () => wx.showToast({ title: '无法打开该文件', icon: 'none' })
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '下载失败', icon: 'none' });
        }
      });
    },

    emitChange() {
      this.triggerEvent('change', { count: this.data.items.length });
    }
  }
});
