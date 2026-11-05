import { backupService } from '../../services/backup.service';
import type { ImportProgress } from '../../services/backup.service';
import { backupFileName, formatSize, formatTimestamp, parseBackup, totalItems } from '../../utils/backup';
import type { BackupFile } from '../../utils/backup';
import { toAppError } from '../../utils/errors';
import { haptic } from '../../utils/haptics';
import { logger } from '../../utils/logger';
import { syncTheme, themeClass } from '../../utils/theme';

interface Preview {
  fileName: string;
  exportedAt: string;
  sameAccount: boolean;
  total: number;
  records: number;
  contacts: number;
  anniversaries: number;
  categories: number;
  templates: number;
}

interface BackupData {
  themeClass: string;

  exporting: boolean;
  exportReady: boolean;
  fileName: string;
  fileSize: string;
  exportedAt: string;
  counts: { categories: number; templates: number; contacts: number; anniversaries: number; records: number };
  total: number;

  picking: boolean;
  importing: boolean;
  preview: Preview | null;
  progressLabel: string;
  progressPercent: number;
  result: string;
  error: string;
}

/** 导出文本留在内存里：分享/复制/写盘都复用它，不重复拉接口。 */
let exported: { file: BackupFile; text: string; filePath: string } | null = null;
/** 待恢复的备份，解析通过才放进来。 */
let pending: BackupFile | null = null;

const EMPTY_COUNTS = { categories: 0, templates: 0, contacts: 0, anniversaries: 0, records: 0 };

Page({
  data: {
    themeClass: themeClass(),
    exporting: false,
    exportReady: false,
    fileName: '',
    fileSize: '',
    exportedAt: '',
    counts: { ...EMPTY_COUNTS },
    total: 0,
    picking: false,
    importing: false,
    preview: null,
    progressLabel: '',
    progressPercent: 0,
    result: '',
    error: ''
  } as BackupData,

  onShow() {
    syncTheme(this);
  },

  async onExport() {
    if (this.data.exporting) return;
    haptic('light');
    this.setData({ exporting: true, error: '', result: '' });

    try {
      const { file, text } = await backupService.exportAll();
      const name = backupFileName(Date.now());
      const saved = await backupService.writeLocalFile(text, name);
      exported = { file, text, filePath: saved.filePath };

      this.setData({
        exporting: false,
        exportReady: true,
        fileName: name,
        fileSize: formatSize(saved.bytes),
        exportedAt: formatTimestamp(file.exported_at),
        counts: file.counts,
        total: totalItems(file.counts)
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('backup', 'export failed', { code: appError.code });
      this.setData({ exporting: false, error: appError.message });
    }
  },

  onShareToChat() {
    if (!exported) return;
    if (!wx.canIUse('shareFileMessage')) {
      wx.showToast({ title: '当前微信版本不支持发送文件', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath: exported.filePath,
      fileName: this.data.fileName,
      fail: (error) => {
        // 用户取消不算错误，不进页面错误区
        logger.warn('backup', 'share cancelled', { reason: String(error && error.errMsg) });
      }
    });
  },

  onSaveToDisk() {
    if (!exported) return;
    if (!wx.canIUse('saveFileToDisk')) {
      wx.showToast({ title: '仅电脑端微信可直接保存到本机', icon: 'none' });
      return;
    }
    wx.saveFileToDisk({
      filePath: exported.filePath,
      fail: (error) => {
        logger.warn('backup', 'save to disk cancelled', { reason: String(error && error.errMsg) });
      }
    });
  },

  onCopyText() {
    if (!exported) return;
    wx.setClipboardData({
      data: exported.text,
      success: () => wx.showToast({ title: '备份内容已复制', icon: 'none' })
    });
  },

  onChooseFile() {
    if (this.data.importing) return;
    haptic('light');
    this.setData({ picking: true, error: '', result: '' });

    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (res) => {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) {
          this.setData({ picking: false });
          return;
        }
        wx.getFileSystemManager().readFile({
          filePath: file.path,
          encoding: 'utf8',
          success: (read) => {
            this.setData({ picking: false });
            this.applyBackupText(String(read.data), file.name || '备份文件');
          },
          fail: () => this.setData({ picking: false, error: '读取文件失败，请重试' })
        });
      },
      fail: (error) => {
        // 用户取消：不报错，只是回到原状
        logger.warn('backup', 'choose file cancelled', { reason: String(error && error.errMsg) });
        this.setData({ picking: false });
      }
    });
  },

  /** 手动粘贴兜底：模拟器/电脑端选不到文件时也能恢复。 */
  onPasteBackup() {
    if (this.data.importing) return;
    wx.showModal({
      title: '粘贴备份内容',
      editable: true,
      placeholderText: '把 .json 文件里的内容整段粘贴进来',
      confirmText: '解析',
      success: (res) => {
        if (!res.confirm || !res.content) return;
        this.applyBackupText(res.content, '粘贴的内容');
      }
    });
  },

  /** 解析并进入预览态。自动化测试直接调这个方法，绕过系统文件选择框。 */
  applyBackupText(text: string, fileName: string) {
    const parsed = parseBackup(text);
    if (!parsed.ok || !parsed.data) {
      pending = null;
      this.setData({ preview: null, error: parsed.error });
      return;
    }

    pending = parsed.data;
    const counts = parsed.data.counts;
    this.setData({
      error: '',
      preview: {
        fileName,
        exportedAt: formatTimestamp(parsed.data.exported_at),
        sameAccount: !!parsed.data.user_id,
        total: totalItems(counts),
        records: counts.records,
        contacts: counts.contacts,
        anniversaries: counts.anniversaries,
        categories: counts.categories,
        templates: counts.templates
      }
    });
  },

  async onStartRestore() {
    if (!pending || this.data.importing) return;

    haptic('medium');
    this.setData({ importing: true, error: '', result: '', progressLabel: '准备', progressPercent: 0 });

    try {
      const summary = await backupService.importAll(pending, (progress: ImportProgress) => {
        const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
        this.setData({
          progressLabel: `${progress.label} ${progress.done}/${progress.total}`,
          progressPercent: percent
        });
      });

      const parts = [`已写入 ${summary.inserted} 条`, `更新 ${summary.updated} 条`];
      if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 条（分类不存在）`);
      if (summary.droppedEnvelopes > 0) {
        parts.push(`丢弃 ${summary.droppedEnvelopes} 个密文字段（换了账号且保险箱未解锁，需重新填写）`);
      }

      this.setData({
        importing: false,
        progressPercent: 100,
        result: parts.join('，'),
        preview: null
      });
      pending = null;
      wx.showToast({ title: '恢复完成', icon: 'none' });
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('backup', 'import failed', { code: appError.code });
      this.setData({ importing: false, error: appError.message });
    }
  }
});
