import { categoryService } from './category.service';
import { userService } from './user.service';

/**
 * 首页概览的两处内存缓存：登录态里的统计数字、分类列表里的 record_count。
 *
 * 两者都是「登录时拉一次就长期有效」的缓存，而云端在任何写操作后都会立刻改计数。
 * 若不显式失效，首页 onShow 重新拉最近记录时能看到新资料，统计卡和快捷新增
 * 却停留在旧值（线上表现：有 1 条记录，资料数仍为 0）。
 */

/** 只清缓存、不发请求。下一次读取会重新取云端数据。 */
export function invalidateOverview(): void {
  userService.invalidate();
  categoryService.invalidate();
}

/**
 * 包一层写操作：成功后失效概览缓存；失败时不动，避免无谓重拉。
 * 用法：return invalidateAfter(call(...))。
 */
export function invalidateAfter<T>(task: Promise<T>): Promise<T> {
  return task.then((value) => {
    invalidateOverview();
    return value;
  });
}
