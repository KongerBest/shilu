import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, decodeBase64Url, encodeBase64Url, utf8Decode, utf8Encode } from '../miniprogram/utils/base64';

describe('base64url', () => {
  it('ASCII 往返一致', () => {
    const samples = ['', 'a', 'ab', 'abc', 'abcd', 'shilu-2026', 'a~b~c'];
    for (const sample of samples) {
      expect(decodeBase64Url(encodeBase64Url(sample))).toBe(sample);
    }
  });

  it('中文与 emoji 往返一致', () => {
    const samples = ['拾录', '个人数字资料库', '纪念日 🎂', '身份证正反面'];
    for (const sample of samples) {
      expect(decodeBase64Url(encodeBase64Url(sample))).toBe(sample);
    }
  });

  it('UTF-8 编解码互为逆运算', () => {
    const text = '拾录 SHILU 资料库';
    expect(utf8Decode(utf8Encode(text))).toBe(text);
  });

  it('不含 padding 与 +/ 字符', () => {
    for (let i = 0; i < 200; i++) {
      const encoded = encodeBase64Url(`id-${i}-${'x'.repeat(i % 7)}`);
      expect(encoded).not.toContain('=');
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
    }
  });

  it('非法字符抛错而不是静默截断', () => {
    expect(() => base64UrlToBytes('abc$def')).toThrow();
    expect(() => base64UrlToBytes('中文')).toThrow();
  });
});
