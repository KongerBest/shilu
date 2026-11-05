import { categoryService } from '../../../services/category.service';
import { contactService } from '../../../services/contact.service';
import { hasEnvelopes, openEnvelopes, sealSensitiveValues } from '../../../services/record-crypto';
import { recordService } from '../../../services/record.service';
import { templateService, sortedFields } from '../../../services/template.service';
import { userService } from '../../../services/user.service';
import { VaultLockedError, vaultSession } from '../../../services/vault-session';
import type { Category, RecordValues, TemplateField } from '../../../types/models';
import { isEnvelope } from '../../../utils/crypto/fields';
import { toAppError } from '../../../utils/errors';
import { coerceValue, isBlank, validateValues } from '../../../utils/field-rules';
import { newRecordId } from '../../../utils/id';
import { logger } from '../../../utils/logger';
import { LIMITS } from '../../../utils/validate';
import { syncTheme, themeClass } from '../../../utils/theme';
import { syncScrollEdge } from '../../../utils/scroll-edge';

interface ContactChip {
  _id: string;
  name: string;
  on: boolean;
}

interface FieldView {
  key: string;
  field: TemplateField;
  value: unknown;
  error: string;
}

interface EditData {
  id: string;
  isEdit: boolean;
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  error: string;
  themeClass: string;

  title: string;
  titleError: string;

  categories: Category[];
  categoryNames: string[];
  categoryIndex: number;

  templateOptions: string[];
  templateIds: (string | null)[];
  templateIndex: number;

  fields: TemplateField[];
  fieldViews: FieldView[];
  hasTemplate: boolean;
  isArchived: boolean;

  /** 当前模板是否含敏感字段（决定是否显示加密提示） */
  hasSensitiveFields: boolean;
  /** 保险箱当前是否解锁（只影响提示文案） */
  vaultUnlocked: boolean;
  /** 记录含密文且未解锁：整页停在「需解锁」态，不进表单 */
  locked: boolean;

  /** 关联人物：默认收起，点「选择」展开 chips */
  contacts: ContactChip[];
  showContactPicker: boolean;
  contactSummary: string;
  selectedContactIds: string[];
}

/** 字段值不放进 data，避免逐字输入时整页 diff；只在需要回填时同步到 fieldViews。 */
let valuesStash: RecordValues = {};

/** 已跳到保险箱页等解锁：返回本页时自动重新加载。 */
let pendingUnlock = false;

function emptyData(): EditData {
  return {
    id: '',
    isEdit: false,
    loading: true,
    saving: false,
    deleting: false,
    error: '',
    themeClass: themeClass(),
    title: '',
    titleError: '',
    categories: [],
    categoryNames: [],
    categoryIndex: 0,
    templateOptions: ['不使用模板'],
    templateIds: [null],
    templateIndex: 0,
    fields: [],
    fieldViews: [],
    hasTemplate: false,
    isArchived: false,
    hasSensitiveFields: false,
    vaultUnlocked: false,
    locked: false,
    contacts: [],
    showContactPicker: false,
    contactSummary: '',
    selectedContactIds: []
  };
}

/** wx.showModal 的 Promise 包装：只关心用户点了哪个按钮。 */
function askModal(options: WechatMiniprogram.ShowModalOption): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      ...options,
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false)
    });
  });
}

Page({
  onPageScroll(e: WechatMiniprogram.Page.IPageScrollOption) {
    syncScrollEdge(this, e.scrollTop);
  },

  onShow() {
    syncTheme(this);
    this.setData({ vaultUnlocked: vaultSession.isUnlocked() });
    // 从保险箱页返回：解锁成功就重新载入（新建时不能重载，否则会把已填内容清空）
    if (pendingUnlock && vaultSession.isUnlocked()) {
      pendingUnlock = false;
      if (this.data.id) void this.onLoad({ id: this.data.id });
      else this.setData({ vaultUnlocked: true });
    }
  },

  data: { ...emptyData() } as EditData,

  async onLoad(options: Record<string, string | undefined>) {
    valuesStash = {};
    const id = options.id || '';
    this.setData({ id, isEdit: id.length > 0, locked: false, error: '' });
    wx.setNavigationBarTitle({ title: id ? '编辑资料' : '新建资料' });

    try {
      // 登录态有内存缓存，这里拿 userId 只为拼字段加密的 AAD 上下文
      const [categories, session, contactList] = await Promise.all([
        categoryService.list(),
        userService.login(),
        // 人物模块不可用时不该挡住资料编辑：失败就当没有人物可选
        contactService.list().catch(() => ({ items: [], total: 0 }))
      ]);
      const contactItems = contactList.items.map((item) => ({ _id: item._id, name: item.name }));

      let categoryId = options.categoryId || '';
      let title = '';
      let templateId: string | null = null;
      let isArchived = false;
      let selectedContactIds: string[] = [];

      if (id) {
        const { item } = await recordService.detail(id);
        title = item.title;
        categoryId = item.category_id;
        templateId = item.template_id;
        isArchived = item.is_archived === 1;
        selectedContactIds = item.contact_ids || [];
        valuesStash = { ...item.values };

        // 密文必须解开才能进表单，否则显示的是 [object Object]，保存还可能把密文弄丢
        if (hasEnvelopes(valuesStash)) {
          if (!vaultSession.isUnlocked()) {
            this.setData({ loading: false, locked: true });
            return;
          }
          try {
            const opened = openEnvelopes(session.user._id, id, valuesStash);
            if (opened.failed.length > 0) {
              this.setData({
                loading: false,
                error: `有 ${opened.failed.length} 个加密字段无法解密（密钥不匹配）。为避免覆盖原密文，已停止编辑。`
              });
              return;
            }
            valuesStash = opened.values;
          } catch (error) {
            // 会话在加载瞬间超时：回到「需解锁」态，而不是把密文当明文塞进表单
            if (error instanceof VaultLockedError) {
              this.setData({ loading: false, locked: true });
              return;
            }
            throw error;
          }
        }
      }

      if (!categoryId) categoryId = categories.length > 0 ? categories[0]._id : '';

      const categoryIndex = Math.max(
        0,
        categories.findIndex((item: Category) => item._id === categoryId)
      );
      const category = categories[categoryIndex];

      // 新建时沿用分类的默认模板；编辑时以记录自身绑定的模板为准
      if (!id) templateId = category ? category.template_id : null;

      // 人物可能已被删除：只保留仍存在的那几个，避免保存时提交脏 ID
      selectedContactIds = selectedContactIds.filter((cid) =>
        contactItems.some((item) => item._id === cid)
      );

      this.setData({
        categories,
        categoryNames: categories.map((item: Category) => item.name),
        categoryIndex,
        title,
        isArchived,
        contacts: contactItems.map((item) => ({
          ...item,
          on: selectedContactIds.indexOf(item._id) >= 0
        })),
        selectedContactIds,
        contactSummary: this.summaryOf(contactItems, selectedContactIds),
        loading: false
      });

      await this.applyCategory(categoryId, templateId, true);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('record-edit', 'load failed', { code: appError.code });
      this.setData({ loading: false, error: appError.message });
    }
  },

  /**
   * 加载某分类下可用模板，并切换到指定模板。
   * @param carryValues true 保留同名字段的值（切模板/首次载入）；false 从空值重建（换分类）
   */
  async applyCategory(categoryId: string, templateId: string | null, carryValues: boolean) {
    const templates = categoryId ? await templateService.list(categoryId, true) : [];

    const templateOptions: string[] = ['不使用模板'];
    const templateIds: (string | null)[] = [null];
    for (const item of templates) {
      templateOptions.push(item.name);
      templateIds.push(item._id);
    }

    let nextId = templateId;
    if (nextId && templateIds.indexOf(nextId) < 0) {
      // 记录绑定的模板可能已被删除或已改绑到别的分类
      nextId = null;
    }
    if (!carryValues && !nextId && !this.data.isEdit) {
      const category = this.data.categories.find((item: Category) => item._id === categoryId);
      if (category && category.template_id && templateIds.indexOf(category.template_id) >= 0) {
        nextId = category.template_id;
      }
    }

    const templateIndex = Math.max(0, templateIds.indexOf(nextId));
    this.setData({ templateOptions, templateIds, templateIndex });

    await this.applyTemplate(templateIds[templateIndex], carryValues);
  },

  async applyTemplate(templateId: string | null, carryValues: boolean) {
    if (!templateId) {
      // 没有模板时不清空 valuesStash：用户可能在临时切换，保存时也不会提交 values
      this.setData({ fields: [], fieldViews: [], hasTemplate: false, hasSensitiveFields: false });
      return;
    }

    const template = await templateService.detail(templateId);
    const fields = sortedFields(template.fields);
    const source = carryValues ? valuesStash : {};

    const next: RecordValues = {};
    for (const field of fields) {
      const hasValue = Object.prototype.hasOwnProperty.call(source, field.key);
      if (hasValue) {
        next[field.key] = source[field.key];
      } else if (!isBlank(field.default_value)) {
        next[field.key] = coerceValue(field, field.default_value);
      } else if (field.type === 'switch') {
        // 开关没默认值时给 false，否则必填开关永远校验不过
        next[field.key] = false;
      }
    }
    valuesStash = next;

    this.setData({
      fields,
      hasTemplate: fields.length > 0,
      hasSensitiveFields: fields.some((field) => field.sensitive),
      fieldViews: fields.map((field) => ({
        key: field.key,
        field,
        value: next[field.key],
        error: ''
      }))
    });
  },

  onTitleInput(e: WechatMiniprogram.Input) {
    this.setData({ title: e.detail.value, titleError: '' });
  },

  async onCategoryChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const category = this.data.categories[index];
    if (!category) return;
    this.setData({ categoryIndex: index });
    try {
      await this.applyCategory(category._id, category.template_id, false);
    } catch (error) {
      wx.showToast({ title: toAppError(error).message, icon: 'none' });
    }
  },

  async onTemplateChange(e: WechatMiniprogram.PickerChange) {
    const index = Number(e.detail.value);
    const templateId = this.data.templateIds[index];
    if (index === this.data.templateIndex) return;

    const hasInput = Object.keys(valuesStash).some((key) => !isBlank(valuesStash[key]));
    const proceed = () => {
      this.setData({ templateIndex: index });
      this.applyTemplate(templateId, true).catch((error) => {
        wx.showToast({ title: toAppError(error).message, icon: 'none' });
      });
    };

    if (!hasInput) {
      proceed();
      return;
    }

    wx.showModal({
      title: '更换表单模板？',
      content: '当前填写的内容会按新模板对齐：同名字段保留，其余字段不再显示。',
      confirmText: '更换',
      success: (res) => {
        if (res.confirm) proceed();
      }
    });
  },

  onFieldChange(e: WechatMiniprogram.CustomEvent<{ key: string; value: unknown }>) {
    const { key, value } = e.detail;
    valuesStash[key] = value;

    const index = this.data.fieldViews.findIndex((view) => view.key === key);
    if (index < 0) return;

    const patch: Record<string, unknown> = {};
    patch[`fieldViews[${index}].value`] = value;
    if (this.data.fieldViews[index].error) {
      patch[`fieldViews[${index}].error`] = '';
    }
    this.setData(patch);
  },

  /** 关联人物摘要：最多列 3 个，多了折叠成 +N，避免把行撑爆。 */
  summaryOf(all: { _id: string; name: string }[], ids: string[]): string {
    if (ids.length === 0) return '未关联';
    const names = ids
      .map((cid) => (all.find((item) => item._id === cid) || { name: '' }).name)
      .filter(Boolean);
    if (names.length === 0) return '未关联';
    return names.length > 3 ? `${names.slice(0, 3).join('、')} +${names.length - 3}` : names.join('、');
  },

  onToggleContactPicker() {
    this.setData({ showContactPicker: !this.data.showContactPicker });
  },

  onCreateContact() {
    wx.navigateTo({ url: '/pages/contacts/edit/index' });
  },

  onContactToggle(e: WechatMiniprogram.TouchEvent) {
    const index = Number(e.currentTarget.dataset.index);
    const contacts = this.data.contacts.slice();
    if (!contacts[index]) return;
    contacts[index] = { ...contacts[index], on: !contacts[index].on };

    const selected = contacts.filter((item) => item.on).map((item) => item._id);
    this.setData({
      contacts,
      selectedContactIds: selected,
      contactSummary: this.summaryOf(contacts, selected)
    });
  },

  async onSave() {
    if (this.data.saving) return;

    const title = this.data.title.trim();
    if (title.length === 0) {
      this.setData({ titleError: '请填写标题' });
      return;
    }
    if (title.length > LIMITS.title) {
      this.setData({ titleError: `标题最多 ${LIMITS.title} 个字` });
      return;
    }
    if (this.data.categories.length === 0) {
      this.setData({ titleError: '还没有可用分类，请先到「我的 - 分类管理」创建' });
      return;
    }

    const category = this.data.categories[this.data.categoryIndex];
    const fields = this.data.fields;

    // 只提交当前模板定义内的键，避免历史字段值把 request 撑大
    const values: RecordValues = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(valuesStash, field.key)) {
        values[field.key] = valuesStash[field.key];
      }
    }

    const errors = validateValues(fields, values);
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const patch: Record<string, unknown> = {};
      this.data.fieldViews.forEach((view, index) => {
        patch[`fieldViews[${index}].error`] = errors[view.key] || '';
      });
      this.setData(patch);
      const firstKey = errorKeys[0];
      const field = fields.find((item) => item.key === firstKey);
      wx.showToast({ title: `${field ? field.label : firstKey}：${errors[firstKey]}`, icon: 'none' });
      return;
    }

    const templateId = this.data.templateIds[this.data.templateIndex] || null;

    // ---- 敏感字段加密 ----
    // 只处理「有值且还是明文」的敏感字段：空白不加密（加密空值等于制造脏数据），
    // 已是信封则原样带回（理论上不会出现——进页面前已解密）。
    const sensitiveKeys = fields.filter(
      (field) => field.sensitive && !isBlank(values[field.key]) && !isEnvelope(values[field.key])
    );

    let recordId = this.data.id;
    let payloadValues = values;

    if (sensitiveKeys.length > 0) {
      if (!vaultSession.isUnlocked()) {
        // 不明文静默落库：让用户选「去解锁」还是「明知风险仍保存」
        const stillSave = await askModal({
          title: '敏感字段未加密',
          content: `保险箱未解锁，${sensitiveKeys.length} 个敏感字段会以明文保存到云端。`,
          confirmText: '仍要保存',
          cancelText: '去解锁',
          confirmColor: '#C2453D'
        });
        if (!stillSave) {
          pendingUnlock = true;
          wx.navigateTo({ url: '/pages/vault/index' });
          return;
        }
      } else {
        try {
          const { user } = await userService.login();
          // 新建时先定 _id，让 AAD 的 recordId 从第一次写入就是最终值
          if (!recordId) recordId = await newRecordId();
          const sealed = await sealSensitiveValues({
            userId: user._id,
            recordId,
            fields,
            values
          });
          payloadValues = sealed.values;
        } catch (error) {
          // 会话在保存瞬间超时：绝不降级成明文，要求重新解锁
          this.setData({ saving: false });
          wx.showModal({
            title: '加密已锁定',
            content:
              error instanceof VaultLockedError
                ? '保险箱已自动锁定，请解锁后重试。'
                : toAppError(error).message,
            showCancel: false
          });
          return;
        }
      }
    }

    this.setData({ saving: true, titleError: '' });

    try {
      if (this.data.isEdit) {
        await recordService.update({
          id: this.data.id,
          title,
          templateId,
          contactIds: this.data.selectedContactIds,
          // 没有模板时不提交 values，避免把已有字段值清空
          ...(fields.length > 0 ? { values: payloadValues } : {})
        });
      } else {
        const created = await recordService.create({
          categoryId: category._id,
          title,
          // 只有加密路径才需要预生成 _id，普通新建交给云端生成
          ...(recordId ? { clientId: recordId } : {}),
          templateId,
          contactIds: this.data.selectedContactIds,
          ...(fields.length > 0 ? { values: payloadValues } : {})
        });

        if (recordId && created.item._id !== recordId) {
          // 兜底：云端没采用 clientId（例如还没部署新版 record 云函数），
          // 密文绑的是旧 ID，必须按真实 _id 重新封包回写，否则这批字段永远解不开。
          const { user } = await userService.login();
          const resealed = await sealSensitiveValues({
            userId: user._id,
            recordId: created.item._id,
            fields,
            values
          });
          await recordService.update({ id: created.item._id, values: resealed.values });
        }
      }
      wx.showToast({ title: '已保存', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('record-edit', 'save failed', { code: appError.code });
      this.setData({ saving: false });
      wx.showModal({ title: '保存失败', content: appError.message, showCancel: false });
    }
  },

  onUnlockTap() {
    if (vaultSession.isUnlocked()) {
      wx.showToast({ title: '保险箱已解锁', icon: 'none' });
      return;
    }
    pendingUnlock = true;
    wx.navigateTo({ url: '/pages/vault/index' });
  },

  onArchiveToggle() {
    if (!this.data.isEdit) return;
    const next = !this.data.isArchived;
    recordService
      .setArchived(this.data.id, next)
      .then(() => {
        this.setData({ isArchived: next });
        wx.showToast({ title: next ? '已归档' : '已取消归档', icon: 'none' });
      })
      .catch((error) => wx.showToast({ title: toAppError(error).message, icon: 'none' }));
  },

  onDelete() {
    if (!this.data.isEdit || this.data.deleting) return;
    wx.showModal({
      title: '删除这条资料？',
      content: '删除后可在 30 天内通过备份恢复，超过期限将永久清除。',
      confirmText: '删除',
      confirmColor: '#C24C3F',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        try {
          await recordService.remove(this.data.id);
          wx.showToast({ title: '已删除', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 400);
        } catch (error) {
          this.setData({ deleting: false });
          wx.showToast({ title: toAppError(error).message, icon: 'none' });
        }
      }
    });
  },

  onRetry() {
    void this.onLoad(this.data.id ? { id: this.data.id } : {});
  }
});
