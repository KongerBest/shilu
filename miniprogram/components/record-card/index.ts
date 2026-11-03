import { relativeTime } from '../../utils/date';

interface CardItem {
  _id: string;
  title: string;
  summary: string;
  is_favorite: 0 | 1;
  is_archived: 0 | 1;
  attachment_count: number;
  updated_at: number;
}

interface CardView extends CardItem {
  timeText: string;
  metaText: string;
}

Component({
  properties: {
    item: {
      type: Object,
      value: {} as CardItem,
      // 组件属性统一是 IAnyObject，进入业务层前再断言为具体类型
      observer(value: WechatMiniprogram.IAnyObject) {
        this.render(value as unknown as CardItem);
      }
    }
  },

  data: {
    view: null as CardView | null
  },

  methods: {
    render(item: CardItem | null) {
      if (!item) {
        this.setData({ view: null });
        return;
      }
      const parts: string[] = [];
      if (item.attachment_count > 0) parts.push(`${item.attachment_count} 个附件`);
      if (item.is_archived === 1) parts.push('已归档');
      this.setData({
        view: {
          ...item,
          timeText: relativeTime(item.updated_at, Date.now()),
          metaText: parts.join(' · ')
        }
      });
    },

    onTap() {
      if (!this.data.view) return;
      this.triggerEvent('tap', { id: this.data.view._id });
    }
  }
});
