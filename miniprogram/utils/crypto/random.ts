/**
 * 密码学安全随机源（CSPRNG）。
 *
 * 加密模块本身是同步纯函数（nonce / iv / salt 一律由调用方传入），
 * 这里只负责「从正确的地方拿随机字节」，因此刻意拆成两套：
 * - `randomBytes`：异步，小程序走 `wx.getUserCryptoManager().getRandomValues`；
 * - `randomBytesSync`：同步，仅供 Node / 测试环境使用，小程序不可用。
 *
 * 生产路径：`await randomBytes(12)` 拿 nonce → 同步调用 AES-GCM 加密。
 */

interface WebCryptoLike {
  getRandomValues: (array: Uint8Array) => Uint8Array;
}

/**
 * 取全局 WebCrypto。用 Function 构造器而不直接写 globalThis：
 * 项目的 tsconfig lib 是 ES2019，未声明 globalThis，直接引用会编译报错。
 * 运行时在 Node ≥ 19 里能拿到 crypto；小程序里没有，会走 wx 分支。
 */
function resolveWebCrypto(): WebCryptoLike | null {
  try {
    const scope = Function('return this')() as unknown as { crypto?: WebCryptoLike };
    const c = scope && scope.crypto;
    return c && typeof c.getRandomValues === 'function' ? c : null;
  } catch (error) {
    return null;
  }
}

/** WebCrypto 的 getRandomValues 单次上限是 65536 字节，超过需分块填充。 */
const MAX_CHUNK = 65536;

export function randomBytesSync(length: number): Uint8Array {
  const crypto = resolveWebCrypto();
  if (!crypto) throw new Error('random: no CSPRNG available in this environment');
  const out = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MAX_CHUNK) {
    crypto.getRandomValues(out.subarray(offset, Math.min(offset + MAX_CHUNK, length)));
  }
  return out;
}

export function randomBytes(length: number): Promise<Uint8Array> {
  if (typeof wx !== 'undefined' && wx.getUserCryptoManager) {
    return new Promise((resolve, reject) => {
      wx.getUserCryptoManager().getRandomValues({
        length,
        success: (res) => resolve(new Uint8Array(res.randomValues)),
        fail: (err) => reject(new Error((err && err.errMsg) || 'random: getRandomValues failed'))
      });
    });
  }
  try {
    return Promise.resolve(randomBytesSync(length));
  } catch (error) {
    return Promise.reject(error);
  }
}
