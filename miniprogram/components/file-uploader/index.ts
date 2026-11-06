import { attachmentService, type AttachmentBiz, type AttachmentRole } from '../../services/attachment.service';
import { initCloud } from '../../services/transport';
import { vaultSession, VaultLockedError } from '../../services/vault-session';
import type { Attachment } from '../../types/models';
import { toAppError } from '../../utils/errors';
import {
  buildFileContext,
  decryptFileToTemp,
  downloadFile,
  encryptFileToTemp,
  sealName,
  unlinkTemp,
  type EncMeta
} from '../../utils/crypto/attachments';
import type { Envelope } from '../../utils/crypto/envelope';

interface UploadItem extends Attachment {
  /** 临时访问链接，图片用于缩略图、文件用于下载（加密附件恒为空，改为占位卡片） */
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

/** 解密预览产生的明文临时文件，组件销毁时统一回收。 */
let plainTempPaths: string[] = [];

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

function confirmModal(title: string, content: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({ title, content, confirmText, success: (res) => resolve(!!res.confirm) });
  });
}

/**
 * 附件上传器。
 *
 * 状态机：idle → uploading(encrypting | progress) → confirming → done | failed。
 * 失败时保留错误文案与重试入口，不静默吞掉；已成功的文件不会重复上传。
 *
 * 加密模式（encrypt=true）：上传前先确保保险库解锁，文件全量读入内存加密后
 * 直传云存储，云端只登记 enc_meta（零明文）；列表显示占位卡片，点击时解密预览。
 */
Component({
  properties: {
    bizType: { type: String, value: 'record' },
    bizId: { type: String, value: '' },
    role: { type: String, value: 'other' },
    /** 归属的模板字段 key。空串 = 资料级自由附件（与模板字段附件互不干扰） */
    fieldKey: { type: String, value: '' },
    /** image = 只允许图片；file = 只允许文件 */
    accept: { type: String, value: 'image' },
    max: { type: Number, value: 9 },
    readonly: { type: Boolean, value: false },
    /** 是否端到端加密（默认关闭，由调用方按功能开关决定） */
    encrypt: { type: Boolean, value: false }
  },

  data: {
    items: [] as UploadItem[],
    loading: false,
    uploading: false,
    /** 加密/解密阶段的文案，如「加密中」「解密中」；为空时显示进度百分比 */
    encryptStep: '',
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
    'bizId, accept, max, fieldKey': function (bizId: string, accept: string, max: number) {
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
    },
    detached() {
      plainTempPaths.forEach(unlinkTemp);
      plainTempPaths = [];
    }
  },

  methods: {
    /** observer 与 attached 都会触发首次加载，这里按「biz + 字段」去重，避免两次并发请求 */
    scheduleLoad() {
      const bizId = this.properties.bizId;
      if (!bizId) return;
      const key = `${bizId}|${this.properties.fieldKey || ''}`;
      if (this.data.loading && this.data.lastBizId === key) return;
      this.setData({ lastBizId: key });
      void this.load();
    },

    /**
     * 加载附件列表。
     *
     * 注意：加载完成**不**触发 change。值为附件 id 数组的字段会把 change 写回
     * 父页面 data，父页面再把它作为 value 传回来；如果加载也发 change，
     * 「加载 → 回写 → 观察器 → 重新加载」会形成死循环（实测每次 3 个
     * listByBiz + 1 个 reSign 无限重复）。只有用户主动上传 / 删除才发 change。
     */
    async load() {
      const bizId = this.properties.bizId;
      if (!bizId) return;
      const token = this.data.loadToken + 1;
      this.setData({ loading: true, error: '', loadToken: token });
      try {
        const res = await attachmentService.listByBiz(this.properties.bizType as AttachmentBiz, bizId);
        if (this.data.loadToken !== token) return;
        // 同一 biz 上先按 role 区分，再按 field_key 区分字段：
        // 普通资料是 other(图片) / file(文件)，证件资料是 front(正面) / back(反面) / other(其他)；
        // 模板字段附件带 field_key，资料级自由附件 field_key 为空。
        const role = this.properties.role;
        const fieldKey = this.properties.fieldKey || '';
        const items: UploadItem[] = res.items
          .filter((item) => item.role === role && (item.field_key || '') === fieldKey)
          .map((item) => Object.assign({ url: '', sizeText: humanSize(item.size) }, item));
        this.setData({ items, loading: false });
        await this.refreshUrls();
      } catch (error) {
        if (this.data.loadToken !== token) return;
        this.setData({ loading: false, error: toAppError(error).message });
      }
    },

    /** 仅明文附件需要临时链接；加密附件不换链接，改为点击时解密预览。 */
    async refreshUrls() {
      const missing = this.data.items.filter((item) => item.encrypted !== 1 && !item.url);
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

    /**
     * 加密模式下，上传/预览前确保保险库可用。
     * 未初始化 / 已锁定都会弹窗引导去 vault 页面，返回 false（本次操作中止）。
     */
    async ensureReady(): Promise<boolean> {
      if (!this.properties.encrypt) return true;
      try {
        const status = await vaultSession.status();
        if (!status.initialized) {
          const go = await confirmModal(
            '开启加密附件',
            '附件将以客户端加密存储，云端只保存密文，只有输入你的主密码才能查看。首次使用需要先设置主密码。',
            '去设置'
          );
          if (go) wx.navigateTo({ url: '/pages/vault/index?mode=setup' });
          return false;
        }
        if (!vaultSession.isUnlocked()) {
          const go = await confirmModal('需要解锁', '上传或查看加密附件前，需要输入主密码解锁。', '去解锁');
          if (go) wx.navigateTo({ url: '/pages/vault/index?mode=unlock' });
          return false;
        }
        return true;
      } catch (error) {
        this.setData({ error: toAppError(error).message });
        return false;
      }
    },

    async onAdd() {
      if (this.data.uploading || this.properties.readonly) return;
      const remain = this.data.limit - this.data.items.length;
      if (remain <= 0) {
        wx.showToast({ title: `最多 ${this.data.limit} 个`, icon: 'none' });
        return;
      }
      // 加密模式先确保解锁，避免选完文件才发现没密钥
      if (!(await this.ensureReady())) return;

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
      this.setData({ uploading: true, error: '', progress: 0, encryptStep: '' });
      let failed = 0;

      for (let i = 0; i < files.length; i++) {
        try {
          await this.uploadOne(files[i], this.data.items.length + i + 1);
        } catch (error) {
          failed++;
          this.setData({ error: toAppError(error).message });
        }
      }

      this.setData({ uploading: false, progress: 0, encryptStep: '' });
      await this.load();
      this.emitChange();
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

      const isEncrypted = this.properties.encrypt;
      // 密文体积 = 明文 + 36 字节（20B 头 + 16B tag），留 64 字节余量避免顶满 20MB
      if (file.size > prep.maxSize || (isEncrypted && file.size + 64 > prep.maxSize)) {
        throw new Error(`单个文件不能超过 ${Math.floor(prep.maxSize / 1024 / 1024)}MB`);
      }

      let uploadPath = file.path;
      let uploadSize = file.size;
      let encMeta: EncMeta | undefined;
      let nameEnc: Envelope | undefined;
      let nameMask: string;

      if (isEncrypted) {
        const key = vaultSession.getKey();
        const kv = vaultSession.keyVersion();
        const ctx = buildFileContext(this.properties.bizType as AttachmentBiz, bizId, prep.cloudPath);

        this.setData({ encryptStep: '加密中' });
        const result = await encryptFileToTemp(key, kv, ctx, file.path);
        uploadPath = result.encPath;
        uploadSize = result.cipherSize;
        encMeta = { alg: 'A256GCM', kv, ctx };

        // 图片没有真实文件名，不加密名；文件类型加密原始文件名并掩码
        if (this.data.acceptImage) {
          nameMask = `加密图片 ${ordinal}`;
        } else {
          nameEnc = await sealName(key, kv, ctx, (file.name || `附件 ${ordinal}`).slice(0, 60));
          nameMask = `加密附件 ${ordinal}`;
        }
        this.setData({ encryptStep: '' });
      } else {
        nameMask = this.data.acceptImage ? `图片 ${ordinal}` : (file.name || `附件 ${ordinal}`).slice(0, 60);
      }

      try {
        const uploaded = await new Promise<{ fileID: string }>((resolve, reject) => {
          const task = wx.cloud.uploadFile({
            cloudPath: prep.cloudPath,
            filePath: uploadPath,
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
          fieldKey: this.properties.fieldKey || '',
          role: this.properties.role as AttachmentRole,
          fileId: uploaded.fileID,
          nameMask,
          mime: file.mime,
          size: uploadSize,
          width: file.width || null,
          height: file.height || null,
          encrypted: isEncrypted ? 1 : 0,
          encMeta,
          nameEnc
        });
      } finally {
        // 加密产生的临时密文文件立即回收（明文临时文件只存在于解密预览，走 detached 清理）
        if (isEncrypted) unlinkTemp(uploadPath);
      }
    },

    /** 下载并解密一个加密附件到本地明文临时文件。 */
    async decryptItem(item: UploadItem): Promise<string> {
      const key = vaultSession.getKey();
      const meta = item.enc_meta;
      if (!meta || !meta.ctx) throw new Error('缺少加密元数据');
      const cipherPath = await downloadFile(item.file_id);
      const { plainPath } = await decryptFileToTemp(key, meta.ctx, cipherPath, item.mime);
      plainTempPaths.push(plainPath);
      return plainPath;
    },

    async onPreview(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item) return;

      if (item.encrypted === 1) {
        if (!(await this.ensureReady())) return;
        this.setData({ encryptStep: '解密中' });
        try {
          const plainPath = await this.decryptItem(item);
          this.setData({ encryptStep: '' });
          wx.previewImage({ urls: [plainPath], current: plainPath });
        } catch (error) {
          this.setData({ encryptStep: '', error: toAppError(error).message });
          wx.showToast({ title: this.friendlyDecryptError(error), icon: 'none' });
        }
        return;
      }

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
            this.emitChange();
            wx.showToast({ title: '已删除', icon: 'none' });
          } catch (error) {
            wx.showToast({ title: toAppError(error).message, icon: 'none' });
          }
        }
      });
    },

    async onFileTap(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const item = this.data.items[index];
      if (!item) return;

      if (item.encrypted === 1) {
        if (!(await this.ensureReady())) return;
        this.setData({ encryptStep: '解密中' });
        try {
          const plainPath = await this.decryptItem(item);
          this.setData({ encryptStep: '' });
          wx.openDocument({
            filePath: plainPath,
            showMenu: true,
            fail: () => wx.showToast({ title: '无法打开该文件', icon: 'none' })
          });
        } catch (error) {
          this.setData({ encryptStep: '', error: toAppError(error).message });
          wx.showToast({ title: this.friendlyDecryptError(error), icon: 'none' });
        }
        return;
      }

      if (!item.url) return;
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

    /** 解密失败时给用户可读的文案，不暴露密钥细节。 */
    friendlyDecryptError(error: unknown): string {
      if (error instanceof VaultLockedError) return error.message;
      const msg = toAppError(error).message;
      return msg.indexOf('bad magic') >= 0 || msg.indexOf('tag') >= 0 ? '无法解密：内容可能已损坏' : msg;
    },

    /** 通知调用方当前附件集合：数量给展示用，ids 用于写入模板字段值。 */
    emitChange() {
      this.triggerEvent('change', {
        count: this.data.items.length,
        ids: this.data.items.map((item) => item._id)
      });
    }
  }
});
