/**
 * 订阅消息模板配置。
 *
 * 模板要在 mp.weixin.qq.com →「订阅消息」里自己申请（一次性订阅），
 * 把模板 ID 与关键词填到这里即可启用。**留空即未配置**：
 * 所有发送路径返回 not_configured，界面如实显示「不可用」，
 * 绝不假装已经能自动提醒。
 *
 * 注意：个人主体只有一次性订阅——用户授权一次 = 一条下发额度，
 * 不能承诺「每年自动提醒」。
 */

const REMINDER_TEMPLATE = {
  /** 形如 'AbCdEf1234567890abcdef1234567890'；留空 = 未配置 */
  id: '',

  /**
   * 模板关键词 → 我们的变量名。
   * 键必须与模板里选的字段**完全一致**（如 thing1 / date2 / thing3）。
   * 值的取值范围见 reminder-plan.buildVars：title / date / days / note。
   */
  fields: {
    thing1: 'title',
    date2: 'date',
    thing3: 'note'
  },

  /** 点击消息后跳到的小程序页面 */
  page: 'pages/anniversaries/index',

  /** formal 正式版 / trial 体验版 / developer 开发版 */
  miniprogramState: 'formal'
};

function isConfigured() {
  return typeof REMINDER_TEMPLATE.id === 'string' && REMINDER_TEMPLATE.id.length > 0;
}

/** 按模板字段表把变量拼成 subscribeMessage.send 的 data。 */
function buildData(vars) {
  const data = {};
  for (const key of Object.keys(REMINDER_TEMPLATE.fields)) {
    const value = vars[REMINDER_TEMPLATE.fields[key]];
    if (value === undefined || value === null || value === '') continue;
    // 订阅消息 thing 类字段上限 20 字，超了整条下发会失败
    data[key] = { value: String(value).slice(0, 20) };
  }
  return data;
}

module.exports = { REMINDER_TEMPLATE, isConfigured, buildData };
