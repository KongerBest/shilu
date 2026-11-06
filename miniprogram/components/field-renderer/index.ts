/**
 * 动态表单字段渲染器。
 *
 * 一条模板字段 → 一个控件。页面只管收集 values，不关心字段类型分支。
 * 组件内部维护显示态（输入框文本、日期分段、多选勾选），
 * 只在「外部传入的 value 与内部显示不一致」时才回写，避免逐字输入时光标跳位。
 */

import type { TemplateField } from '../../types/models';
import { coerceValue, FIELD_TYPE_LABELS } from '../../utils/field-rules';

interface OptionView {
  label: string;
  value: string;
  checked: boolean;
}

interface FieldRendererData {
  text: string;
  datePart: string;
  timePart: string;
  boolValue: boolean;
  selectIndex: number;
  selectLabel: string;
  optionLabels: string[];
  options: OptionView[];
  placeholder: string;
  maxlength: number;
  inputType: 'text' | 'number' | 'digit';
  isInput: boolean;
  isAttachment: boolean;
  attachmentAccept: 'image' | 'file';
  attachmentRole: 'other' | 'file';
  attachmentMax: number;
  typeLabel: string;
  deferred: boolean;
}

const INPUT_TYPES = ['text', 'number', 'phone', 'email', 'url', 'location_text'];

function asString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

Component({
  properties: {
    field: {
      type: Object,
      value: {} as TemplateField
    },
    /**
     * 值可能是字符串/数字/布尔/数组，没有单一构造器可用。
     * 运行期必须是 type: null（原样透传，不做类型转换），
     * 但 WeChat 的 d.ts 只接受构造器，这里转换一次类型声明，不改变运行期语义。
     */
    value: { type: null, value: null } as unknown as {
      type: StringConstructor;
      value: string;
    },
    error: {
      type: String,
      value: ''
    },
    disabled: {
      type: Boolean,
      value: false
    },
    /**
     * 附件字段的归属记录 id。
     * 新建资料时由编辑页预生成（记录还没落库，附件先挂在这个 id 上）。
     */
    bizId: {
      type: String,
      value: ''
    },
    /** 附件是否端到端加密上传（跟随构建开关，与资料详情页的图片区一致） */
    encrypt: {
      type: Boolean,
      value: false
    }
  },

  data: {
    text: '',
    datePart: '',
    timePart: '',
    boolValue: false,
    selectIndex: -1,
    selectLabel: '',
    optionLabels: [],
    options: [] as OptionView[],
    placeholder: '',
    maxlength: -1,
    inputType: 'text',
    isInput: false,
    isAttachment: false,
    attachmentAccept: 'image',
    attachmentRole: 'other',
    attachmentMax: 9,
    typeLabel: '',
    deferred: false
  } as FieldRendererData,

  observers: {
    'field, value': function () {
      this.refresh();
    }
  },

  methods: {
    refresh() {
      const field = this.properties.field as TemplateField | null;
      // 属性声明被迫写成 string，实际可能是任意类型，这里还原真实类型
      const value = this.properties.value as unknown;

      if (!field || !field.type) {
        this.setData({ deferred: true, typeLabel: '' });
        return;
      }

      const isPicker = field.type === 'date' || field.type === 'select';
      const isAttachment = field.type === 'image' || field.type === 'file';
      const patch: Partial<FieldRendererData> = {
        isInput: INPUT_TYPES.indexOf(field.type) >= 0,
        inputType:
          field.type === 'number' ? 'digit' : field.type === 'phone' ? 'number' : 'text',
        isAttachment,
        attachmentAccept: field.type === 'file' ? 'file' : 'image',
        attachmentRole: field.type === 'file' ? 'file' : 'other',
        attachmentMax: field.type === 'file' ? 5 : 9,
        typeLabel: FIELD_TYPE_LABELS[field.type] || field.type,
        deferred: false,
        placeholder: field.placeholder || `${isPicker ? '请选择' : '请输入'}${field.label}`,
        maxlength: field.max_length && field.max_length > 0 ? field.max_length : -1
      };

      if (field.type === 'select' || field.type === 'multi_select') {
        const options = field.options || [];
        patch.optionLabels = options.map((option) => option.label);
        patch.options = options.map((option) => ({
          label: option.label,
          value: option.value,
          checked: Array.isArray(value) ? value.indexOf(option.value) >= 0 : value === option.value
        }));
        const index = options.findIndex((option) => option.value === value);
        patch.selectIndex = index;
        patch.selectLabel = index >= 0 ? options[index].label : '';
      }

      if (field.type === 'switch') {
        patch.boolValue = value === true;
      }

      if (field.type === 'datetime') {
        const text = asString(value);
        const parts = text.split(/[ T]/);
        patch.datePart = parts[0] || '';
        patch.timePart = parts[1] || '';
        patch.text = text;
      } else if (field.type !== 'select' && field.type !== 'multi_select' && field.type !== 'switch') {
        const text = asString(value);
        // 值没变就不 setData，否则逐字输入会被回写打断
        if (text !== this.data.text) patch.text = text;
      }

      this.setData(patch);
    },

    emit(value: unknown) {
      const field = this.properties.field as TemplateField;
      this.triggerEvent('change', { key: field.key, value });
    },

    onInput(e: WechatMiniprogram.Input) {
      const field = this.properties.field as TemplateField;
      const raw = e.detail.value;
      this.setData({ text: raw });

      if (field.type === 'number') {
        const trimmed = raw.trim();
        this.emit(trimmed.length === 0 ? null : Number.isFinite(Number(trimmed)) ? Number(trimmed) : raw);
        return;
      }
      this.emit(raw);
    },

    /** 失焦时做一次归一化（手机号去空格/短横），并同步回显示。 */
    onBlur() {
      const field = this.properties.field as TemplateField;
      const next = coerceValue(field, this.data.text);
      if (typeof next === 'string' && next !== this.data.text) {
        this.setData({ text: next });
      }
      this.emit(next);
    },

    onDateChange(e: WechatMiniprogram.PickerChange) {
      this.setData({ text: String(e.detail.value) });
      this.emit(String(e.detail.value));
    },

    onDatePart(e: WechatMiniprogram.PickerChange) {
      const datePart = String(e.detail.value);
      const timePart = this.data.timePart || '00:00';
      this.setData({ datePart, timePart });
      this.emit(`${datePart} ${timePart}`);
    },

    onTimePart(e: WechatMiniprogram.PickerChange) {
      const timePart = String(e.detail.value);
      if (!this.data.datePart) {
        // 没有日期的时间没有意义，先让用户选日期
        wx.showToast({ title: '请先选择日期', icon: 'none' });
        return;
      }
      this.setData({ timePart });
      this.emit(`${this.data.datePart} ${timePart}`);
    },

    onSelect(e: WechatMiniprogram.PickerChange) {
      const field = this.properties.field as TemplateField;
      const index = Number(e.detail.value);
      const options = field.options || [];
      if (index < 0 || index >= options.length) return;
      this.setData({ selectIndex: index, selectLabel: options[index].label });
      this.emit(options[index].value);
    },

    onToggleMulti(e: WechatMiniprogram.TouchEvent) {
      if (this.properties.disabled) return;
      const value = e.currentTarget.dataset.value as string;
      const options = this.data.options.map((option) =>
        option.value === value ? { ...option, checked: !option.checked } : option
      );
      this.setData({ options });
      this.emit(options.filter((option) => option.checked).map((option) => option.value));
    },

    onSwitch(e: WechatMiniprogram.SwitchChange) {
      this.setData({ boolValue: e.detail.value });
      this.emit(e.detail.value);
    },

    /**
     * 附件变化：上传器回传当前附件 id 列表，字段值就是这个数组。
     * 上传/删除即时生效（附件是独立资源），表单「保存」只落 values。
     */
    onAttachmentChange(e: WechatMiniprogram.CustomEvent<{ count: number; ids: string[] }>) {
      const ids = e.detail && Array.isArray(e.detail.ids) ? e.detail.ids : [];
      this.emit(ids);
    }
  }
});
