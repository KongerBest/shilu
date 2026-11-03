Component({
  properties: {
    value: { type: String, value: '' },
    placeholder: { type: String, value: '搜索标题或内容' },
    focus: { type: Boolean, value: false },
    /** readonly 时点击不聚焦，改为抛 tap（用于首页跳转） */
    readonly: { type: Boolean, value: false }
  },

  data: {
    inner: ''
  },

  observers: {
    value(v: string) {
      if (v !== this.data.inner) this.setData({ inner: v });
    }
  },

  methods: {
    onInput(e: WechatMiniprogram.Input) {
      const next = e.detail.value;
      this.setData({ inner: next });
      this.triggerEvent('input', { value: next });
    },

    onConfirm(e: WechatMiniprogram.Input) {
      this.triggerEvent('confirm', { value: e.detail.value });
    },

    onClear() {
      this.setData({ inner: '' });
      this.triggerEvent('input', { value: '' });
      this.triggerEvent('confirm', { value: '' });
    },

    onTapReadonly() {
      if (this.data.readonly) this.triggerEvent('tap');
    }
  }
});
