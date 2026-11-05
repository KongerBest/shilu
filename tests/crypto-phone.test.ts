import { describe, expect, it } from 'vitest';

import { isMasked, maskPhone } from '../miniprogram/utils/crypto/phone';
import { contactPhoneContext } from '../miniprogram/services/contact-crypto';
import { fieldContext, openFieldValue, sealFieldValue } from '../miniprogram/utils/crypto/fields';
import { randomBytesSync } from '../miniprogram/utils/crypto/random';

const KEY = randomBytesSync(32);

describe('phone · 脱敏', () => {
  it('11 位手机号保留前 3 后 4', () => {
    expect(maskPhone('13800001111')).toBe('138****1111');
  });

  it('带国际区号时中间全掩，长度不变', () => {
    const masked = maskPhone('+8613800001111');
    expect(masked.startsWith('+86')).toBe(true);
    expect(masked.endsWith('1111')).toBe(true);
    expect(masked).toBe('+86*******1111');
    expect(masked).toHaveLength('+8613800001111'.length);
  });

  it('短号只留首尾各一位，不会把整串吐出来', () => {
    expect(maskPhone('12345')).toBe('1***5');
  });

  it('7 位号码不能按「前 3 后 4」露全脸', () => {
    expect(maskPhone('1234567')).toBe('1*****7');
  });

  it('两位以内的号码全掩', () => {
    expect(maskPhone('12')).toBe('**');
    expect(maskPhone('1')).toBe('*');
  });

  it('空值与空白返回空串', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('   ')).toBe('');
  });

  it('脱敏结果必然含星号（云端据此拒绝伪脱敏）', () => {
    for (const value of ['13800001111', '+8613800001111', '12345', '1234567']) {
      expect(isMasked(maskPhone(value))).toBe(true);
    }
  });
});

describe('phone · AAD 上下文', () => {
  it('绑定 userId:contactId:phone，换人即失效', async () => {
    const a = contactPhoneContext('user_1', 'c'.repeat(32));
    const b = contactPhoneContext('user_1', 'd'.repeat(32));
    expect(a).not.toBe(b);
    expect(a).toBe(fieldContext('user_1', 'c'.repeat(32), 'phone'));

    const env = await sealFieldValue(KEY, 1, a, '13800001111');
    expect(openFieldValue(KEY, a, env)).toBe('13800001111');
    // 把密文挪到另一个人身上，GCM 校验必须失败
    expect(() => openFieldValue(KEY, b, env)).toThrow();
  });
});
