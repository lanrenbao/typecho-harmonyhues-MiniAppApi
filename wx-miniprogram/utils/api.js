const { request } = require('./request');

module.exports = {
  /** 文章列表：page / pageSize / category(mid) / q(标题搜索) */
  getPosts(params) {
    return request('/api/posts', params || {});
  },
  /** 文章详情：id 或 slug */
  getPost(params) {
    return request('/api/post', params || {});
  },
  /** 全部分类及文章数 */
  getCategories() {
    return request('/api/categories', {});
  },
  /** 站点标题 / 描述 / 关于文案 / 功能开关 / 轮播 */
  getConfig() {
    return request('/api/config', {});
  },
  /** 归档：封面 + 站点统计 + 按月文章 */
  getArchives() {
    return request('/api/archives', {}, { retry: 0 });
  },
  /** 一言：关于页卡片（插件服务端代理第三方接口） */
  getHitokoto() {
    return request('/api/hitokoto', {}, { retry: 0, timeout: 8000 });
  },
  /** 探活自检，返回插件 / PHP / Typecho 版本 */
  ping() {
    return request('/api/ping', {}, { retry: 0, timeout: 8000 });
  },
  /** 诊断摘要与封面抽取结果，出问题时用 */
  debug(id) {
    return request('/api/debug', { id: id || '' }, { retry: 0 });
  }
};
