/**
 * 系统预设分类与预设模板的纯数据定义。
 *
 * 刻意不依赖 db / wx-server-sdk，这样测试可以直接校验预设定义本身合法
 * （tests/template-schema.test.ts 会跑一遍 normalizeFields，防止上线才发现预设写错）。
 */

/**
 * 预设结构版本。新增/调整预设时 +1，登录时会重新走一次幂等播种。
 *
 * v2：分类播种改为按 system_key 幂等补齐，用于修复 v1 时期「首登中断 → 分类永久缺失」的账号。
 */
const PRESET_VERSION = 2;

const PRESET_CATEGORIES = [
  { name: '人物档案', icon: 'person', color: '#2F5D50', system_key: 'person' },
  { name: '工作档案', icon: 'work', color: '#3E5C76', system_key: 'work' },
  { name: '证件资料', icon: 'document', color: '#8A6A3B', system_key: 'document' },
  { name: '日常备忘', icon: 'memo', color: '#5C6B5A', system_key: 'memo' },
  { name: '重要资料', icon: 'important', color: '#8C4A3F', system_key: 'important' },
  { name: '账号资料', icon: 'account', color: '#5A5470', system_key: 'account' },
  { name: '自定义分类', icon: 'custom', color: '#6B6B66', system_key: 'custom' }
];

/**
 * 预设模板。
 *
 * 两个刻意的取舍，都写进 docs/PRD.md：
 * 1. 「账号资料」不含密码字段——密码属于保险箱（自用构建），
 *    在普通资料里放密码字段会与个人主体审核规则冲突。
 * 2. 证件正反面属于 image 字段，阶段三附件服务落地后才加入模板。
 */
const PRESET_TEMPLATES = [
  {
    system_key: 'person',
    name: '人物档案',
    fields: [
      { key: 'name', label: '姓名', type: 'text', required: true, max_length: 24 },
      {
        key: 'relation',
        label: '关系',
        type: 'select',
        options: [
          { label: '家人', value: 'family' },
          { label: '朋友', value: 'friend' },
          { label: '同事', value: 'colleague' },
          { label: '同学', value: 'classmate' },
          { label: '其他', value: 'other' }
        ]
      },
      { key: 'phone', label: '手机号', type: 'phone', sensitive: true },
      { key: 'birthday', label: '生日', type: 'date' },
      { key: 'note', label: '备注', type: 'textarea', max_length: 500 }
    ]
  },
  {
    system_key: 'work',
    name: '工作档案',
    fields: [
      { key: 'org', label: '单位 / 项目', type: 'text', required: true, max_length: 60 },
      { key: 'role', label: '角色', type: 'text', max_length: 40 },
      { key: 'start_on', label: '开始日期', type: 'date' },
      { key: 'end_on', label: '结束日期', type: 'date' },
      { key: 'content', label: '工作内容', type: 'textarea', max_length: 2000 },
      { key: 'link', label: '相关链接', type: 'url' }
    ]
  },
  {
    system_key: 'document',
    name: '证件资料',
    fields: [
      {
        key: 'doc_type',
        label: '证件类型',
        type: 'select',
        required: true,
        options: [
          { label: '身份证', value: 'id_card' },
          { label: '护照', value: 'passport' },
          { label: '驾驶证', value: 'driver' },
          { label: '行驶证', value: 'vehicle' },
          { label: '学生证', value: 'student' },
          { label: '毕业证', value: 'graduation' },
          { label: '学位证', value: 'degree' },
          { label: '工作证', value: 'staff' },
          { label: '职业资格证', value: 'qualification' },
          { label: '其他', value: 'other' }
        ]
      },
      { key: 'doc_no', label: '证件号码', type: 'text', required: true, sensitive: true, max_length: 40 },
      { key: 'issuer', label: '签发机关', type: 'text', max_length: 60 },
      { key: 'issue_on', label: '签发日期', type: 'date' },
      { key: 'expire_on', label: '有效期至', type: 'date' },
      { key: 'note', label: '备注', type: 'textarea', max_length: 500 }
    ]
  },
  {
    system_key: 'memo',
    name: '日常备忘',
    fields: [
      { key: 'content', label: '内容', type: 'textarea', required: true, max_length: 2000 },
      { key: 'happened_on', label: '日期', type: 'date' }
    ]
  },
  {
    system_key: 'important',
    name: '重要资料',
    fields: [
      { key: 'content', label: '内容', type: 'textarea', required: true, max_length: 2000 },
      { key: 'source', label: '来源', type: 'text', max_length: 60 },
      { key: 'got_on', label: '获取日期', type: 'date' },
      { key: 'note', label: '补充说明', type: 'textarea', max_length: 500 }
    ]
  },
  {
    system_key: 'account',
    name: '账号资料',
    fields: [
      { key: 'platform', label: '平台 / 网站', type: 'text', required: true, max_length: 60 },
      { key: 'account', label: '账号', type: 'text', sensitive: true, required: true, max_length: 80 },
      { key: 'bind_phone', label: '绑定手机', type: 'phone', sensitive: true },
      { key: 'site', label: '网址', type: 'url' },
      { key: 'note', label: '备注', type: 'textarea', max_length: 500 }
    ]
  }
];

module.exports = { PRESET_VERSION, PRESET_CATEGORIES, PRESET_TEMPLATES };
