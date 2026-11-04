import { call } from './transport';
import type { Attachment } from '../types/models';

export type AttachmentBiz = 'record' | 'contact' | 'document';
export type AttachmentRole = 'front' | 'back' | 'other' | 'avatar' | 'file';

export interface PrepareUploadResult {
  cloudPath: string;
  role: AttachmentRole;
  maxSize: number;
  ownerTag: string;
}

export interface ConfirmUploadInput {
  bizType: AttachmentBiz;
  bizId: string;
  role: AttachmentRole;
  fileId: string;
  nameMask: string;
  mime?: string;
  size: number;
  width?: number | null;
  height?: number | null;
  sha256?: string;
}

export interface SignedUrl {
  id: string;
  tempUrl: string;
  expiresAt: number;
}

/**
 * 附件服务。
 *
 * 分工：客户端直传云存储（不经过云函数，避免 1MB 调用载荷上限），
 * 云函数只负责「发路径 → 验归属 → 登记元数据」，文件流从不进函数。
 */
export const attachmentService = {
  prepareUpload(input: {
    bizType: AttachmentBiz;
    bizId: string;
    role?: AttachmentRole;
    ext?: string;
  }): Promise<PrepareUploadResult> {
    return call<PrepareUploadResult>('attachment', 'prepareUpload', input);
  },

  confirmUpload(input: ConfirmUploadInput): Promise<{ item: Attachment }> {
    return call<{ item: Attachment }>('attachment', 'confirmUpload', input);
  },

  listByBiz(bizType: AttachmentBiz, bizId: string): Promise<{ items: Attachment[] }> {
    return call<{ items: Attachment[] }>('attachment', 'listByBiz', { bizType, bizId });
  },

  updateMeta(input: {
    id: string;
    role?: AttachmentRole;
    nameMask?: string;
    sortOrder?: number;
  }): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('attachment', 'updateMeta', input);
  },

  reorder(ids: string[]): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('attachment', 'reorder', { ids });
  },

  remove(id: string): Promise<{ ok: boolean }> {
    return call<{ ok: boolean }>('attachment', 'remove', { id });
  },

  reSign(ids: string[]): Promise<{ items: SignedUrl[] }> {
    return call<{ items: SignedUrl[] }>('attachment', 'reSign', { ids });
  }
};
